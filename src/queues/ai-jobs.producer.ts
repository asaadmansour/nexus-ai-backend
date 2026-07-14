import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { AI_JOB_RETRY, JOBS, QUEUES } from './queue.constants';
import {
  AssessmentGenerationJobData,
  CvExtractionJobData,
  ProfileEmbeddingJobData,
} from './queue.types';

const CV_EXTRACTION_JOB_TYPE = 'cv_extraction';
const ASSESSMENT_GENERATION_JOB_TYPE = 'assessment_generation';
const PROFILE_EMBEDDING_JOB_TYPE = 'profile_embedding';
const AI_QUEUE_JOB_OPTIONS = {
  attempts: AI_JOB_RETRY.ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: AI_JOB_RETRY.BACKOFF_DELAY_MS,
  },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

@Injectable()
export class AiJobsProducer {
  constructor(
    @InjectQueue(QUEUES.CV_EXTRACTION)
    private readonly cvExtractionQueue: Queue<CvExtractionJobData>,
    @InjectQueue(QUEUES.ASSESSMENT_GENERATION)
    private readonly assessmentGenerationQueue: Queue<AssessmentGenerationJobData>,
    @InjectQueue(QUEUES.PROFILE_EMBEDDING)
    private readonly profileEmbeddingQueue: Queue<ProfileEmbeddingJobData>,
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
        maxAttempts: AI_JOB_RETRY.ATTEMPTS,
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
        { ...AI_QUEUE_JOB_OPTIONS, jobId: agentJob.id },
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
        maxAttempts: AI_JOB_RETRY.ATTEMPTS,
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
        { ...AI_QUEUE_JOB_OPTIONS, jobId: agentJob.id },
      );

      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
      return agentJob;
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
  }

  async emitProfileEmbeddingRequested(input: {
    userId: string;
    profileId: string;
    assessmentId?: string | null;
    reason: string;
  }) {
    const agentJob = await this.agentJobRepository.save(
      this.agentJobRepository.create({
        agentName: PROFILE_EMBEDDING_JOB_TYPE,
        jobType: PROFILE_EMBEDDING_JOB_TYPE,
        userId: input.userId,
        freelancerProfileId: input.profileId,
        assessmentId: input.assessmentId ?? null,
        status: 'queued',
        maxAttempts: AI_JOB_RETRY.ATTEMPTS,
        queueName: QUEUES.PROFILE_EMBEDDING,
        input: {
          userId: input.userId,
          profileId: input.profileId,
          assessmentId: input.assessmentId ?? null,
          reason: input.reason,
        },
      }),
    );

    try {
      await this.profileEmbeddingQueue.add(
        JOBS.GENERATE_PROFILE_EMBEDDING,
        {
          agentJobId: agentJob.id,
          userId: input.userId,
          profileId: input.profileId,
          assessmentId: input.assessmentId ?? null,
          reason: input.reason,
        },
        { ...AI_QUEUE_JOB_OPTIONS, jobId: agentJob.id },
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
