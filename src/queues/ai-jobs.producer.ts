import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { JOBS, QUEUES } from './queue.constants';
import {
  AssessmentGenerationJobData,
  CvExtractionJobData,
} from './queue.types';

const CV_EXTRACTION_JOB_TYPE = 'cv_extraction';
const ASSESSMENT_GENERATION_JOB_TYPE = 'assessment_generation';

@Injectable()
export class AiJobsProducer {
  constructor(
    @InjectQueue(QUEUES.CV_EXTRACTION)
    private readonly cvExtractionQueue: Queue<CvExtractionJobData>,
    @InjectQueue(QUEUES.ASSESSMENT_GENERATION)
    private readonly assessmentGenerationQueue: Queue<AssessmentGenerationJobData>,
    @InjectRepository(AgentJob)
    private readonly agentJobRepository: Repository<AgentJob>,
  ) {}

  async emitCvUploaded(input: {
    userId: string;
    profileId: string;
    cvUrl: string;
  }) {
    const agentJob = await this.agentJobRepository.save(
      this.agentJobRepository.create({
        agentName: CV_EXTRACTION_JOB_TYPE,
        jobType: CV_EXTRACTION_JOB_TYPE,
        userId: input.userId,
        freelancerProfileId: input.profileId,
        status: 'queued',
        queueName: QUEUES.CV_EXTRACTION,
        input: {
          userId: input.userId,
          profileId: input.profileId,
          cvUrl: input.cvUrl,
        },
      }),
    );

    try {
      await this.cvExtractionQueue.add(
        JOBS.EXTRACT_CV,
        {
          agentJobId: agentJob.id,
          userId: input.userId,
          profileId: input.profileId,
          cvUrl: input.cvUrl,
        },
        { jobId: agentJob.id },
      );

      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
      return agentJob;
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
  }

  async emitCvExtracted(input: {
    userId: string;
    profileId: string;
    cvUrl: string;
    questionCount: number;
    durationSeconds: number;
  }) {
    const agentJob = await this.agentJobRepository.save(
      this.agentJobRepository.create({
        agentName: ASSESSMENT_GENERATION_JOB_TYPE,
        jobType: ASSESSMENT_GENERATION_JOB_TYPE,
        userId: input.userId,
        freelancerProfileId: input.profileId,
        status: 'queued',
        queueName: QUEUES.ASSESSMENT_GENERATION,
        input: {
          userId: input.userId,
          profileId: input.profileId,
          cvUrl: input.cvUrl,
          questionCount: input.questionCount,
          durationSeconds: input.durationSeconds,
        },
      }),
    );

    try {
      await this.assessmentGenerationQueue.add(
        JOBS.GENERATE_ASSESSMENT,
        {
          agentJobId: agentJob.id,
          userId: input.userId,
          profileId: input.profileId,
          cvUrl: input.cvUrl,
          questionCount: input.questionCount,
          durationSeconds: input.durationSeconds,
        },
        { jobId: agentJob.id },
      );

      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
      return agentJob;
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
  }

  private async markQueueAddFailed(agentJob: AgentJob, error: unknown) {
    agentJob.status = 'failed';
    agentJob.failedAt = new Date();
    agentJob.error = this.getErrorMessage(error);
    await this.agentJobRepository.save(agentJob);
  }

  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
