import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import {
  AI_JOB_RETRY,
  AI_JOB_TYPES,
  AI_QUEUE_JOB_OPTIONS,
  JOBS,
  QUEUES,
} from './queue.constants';
import {
  AssessmentGenerationJobData,
  CvExtractionJobData,
  ProfileEmbeddingJobData,
  ProjectPlanGenerationJobData,
} from './queue.types';

@Injectable()
export class AiJobsProducer {
  constructor(
    @Optional()
    @InjectQueue(QUEUES.CV_EXTRACTION)
    private readonly cvExtractionQueue: Queue<CvExtractionJobData> | null,
    @Optional()
    @InjectQueue(QUEUES.ASSESSMENT_GENERATION)
    private readonly assessmentGenerationQueue: Queue<AssessmentGenerationJobData> | null,
    @Optional()
    @InjectQueue(QUEUES.PROFILE_EMBEDDING)
    private readonly profileEmbeddingQueue: Queue<ProfileEmbeddingJobData> | null,
    @Optional()
    @InjectQueue(QUEUES.PROJECT_PLAN_GENERATION)
    private readonly projectPlanGenerationQueue: Queue<ProjectPlanGenerationJobData> | null,
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
        agentName: AI_JOB_TYPES.CV_EXTRACTION,
        jobType: AI_JOB_TYPES.CV_EXTRACTION,
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
      await this.getQueue(this.cvExtractionQueue, QUEUES.CV_EXTRACTION).add(
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
        agentName: AI_JOB_TYPES.ASSESSMENT_GENERATION,
        jobType: AI_JOB_TYPES.ASSESSMENT_GENERATION,
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
      await this.getQueue(
        this.assessmentGenerationQueue,
        QUEUES.ASSESSMENT_GENERATION,
      ).add(
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
        agentName: AI_JOB_TYPES.PROFILE_EMBEDDING,
        jobType: AI_JOB_TYPES.PROFILE_EMBEDDING,
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
      await this.getQueue(
        this.profileEmbeddingQueue,
        QUEUES.PROFILE_EMBEDDING,
      ).add(
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

  async emitProjectPlanGenerationRequested(input: {
    projectId: string;
    architectureSubmissionId?: string | null;
    uiuxSubmissionId?: string | null;
    requestedBy?: string | null;
    notes?: string | null;
  }) {
    const agentJob = await this.agentJobRepository.save(
      this.agentJobRepository.create({
        agentName: AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
        jobType: AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
        projectId: input.projectId,
        status: 'queued',
        maxAttempts: AI_JOB_RETRY.ATTEMPTS,
        queueName: QUEUES.PROJECT_PLAN_GENERATION,
        input: {
          projectId: input.projectId,
          architectureSubmissionId: input.architectureSubmissionId ?? null,
          uiuxSubmissionId: input.uiuxSubmissionId ?? null,
          requestedBy: input.requestedBy ?? null,
          notes: input.notes ?? null,
        },
      }),
    );

    try {
      await this.getQueue(
        this.projectPlanGenerationQueue,
        QUEUES.PROJECT_PLAN_GENERATION,
      ).add(
        JOBS.GENERATE_PROJECT_PLAN,
        {
          agentJobId: agentJob.id,
          projectId: input.projectId,
          architectureSubmissionId: input.architectureSubmissionId ?? null,
          uiuxSubmissionId: input.uiuxSubmissionId ?? null,
          requestedBy: input.requestedBy ?? null,
          notes: input.notes ?? null,
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

  private getQueue<T>(queue: Queue<T> | null, queueName: string): Queue<T> {
    if (!queue) {
      throw new ServiceUnavailableException(
        `Queue system is disabled; cannot enqueue ${queueName}`,
      );
    }

    return queue;
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
