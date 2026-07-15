import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import {
  AI_JOB_RECOVERY,
  AI_JOB_TYPES,
  AI_QUEUE_JOB_OPTIONS,
  JOBS,
  QUEUES,
} from './queue.constants';
import {
  AssessmentGenerationJobData,
  CvExtractionJobData,
  ProfileEmbeddingJobData,
} from './queue.types';

type RecoverableJobType = (typeof AI_JOB_TYPES)[keyof typeof AI_JOB_TYPES];

const RECOVERABLE_JOB_TYPES = Object.values(
  AI_JOB_TYPES,
) as RecoverableJobType[];

@Injectable()
export class AiJobRecoveryService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AiJobRecoveryService.name);
  private scanTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private scanRunning = false;

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

  onModuleInit() {
    this.startupTimer = setTimeout(() => {
      void this.recoverFailedJobs();
    }, AI_JOB_RECOVERY.STARTUP_DELAY_MS);

    this.scanTimer = setInterval(() => {
      void this.recoverFailedJobs();
    }, AI_JOB_RECOVERY.SCAN_INTERVAL_MS);
  }

  onApplicationShutdown() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  async recoverFailedJobs() {
    if (this.scanRunning) return;

    this.scanRunning = true;
    try {
      const cutoff = new Date(Date.now() - AI_JOB_RECOVERY.REQUEUE_AFTER_MS);
      const jobs = await this.agentJobRepository.find({
        where: {
          status: 'failed',
          jobType: In(RECOVERABLE_JOB_TYPES),
          failedAt: LessThanOrEqual(cutoff),
        },
        order: { failedAt: 'ASC', createdAt: 'ASC' },
        take: AI_JOB_RECOVERY.BATCH_SIZE,
      });

      for (const job of jobs) {
        await this.requeueFailedJob(job, {
          cutoff,
          source: 'automatic',
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed AI job recovery scan crashed: ${this.getErrorMessage(error)}`,
      );
    } finally {
      this.scanRunning = false;
    }
  }

  async retryFailedJobNow(agentJobId: string) {
    const job = await this.agentJobRepository.findOne({
      where: { id: agentJobId },
    });

    if (!job) {
      throw new NotFoundException('Agent job not found');
    }

    if (job.status !== 'failed') {
      throw new BadRequestException('Only failed agent jobs can be retried');
    }

    const queued = await this.requeueFailedJob(job, {
      source: 'manual',
    });

    if (!queued) {
      throw new ConflictException(
        'Agent job could not be claimed for retry. It may already be queued.',
      );
    }

    return this.agentJobRepository.findOneOrFail({
      where: { id: agentJobId },
    });
  }

  private async requeueFailedJob(
    job: AgentJob,
    options: { cutoff?: Date; source: 'automatic' | 'manual' },
  ) {
    const payload = this.toQueuePayload(job);
    if (!payload) {
      this.logger.warn(
        `Skipping failed AI job ${job.id}; saved input is not recoverable`,
      );
      if (options.source === 'manual') {
        throw new BadRequestException(
          'This failed agent job cannot be retried from its saved payload',
        );
      }
      return false;
    }

    const recoveryCount = this.getRecoveryCount(job.output) + 1;
    const queueJobId = `${job.id}-${options.source}-retry-${recoveryCount}-${Date.now()}`;
    const output = {
      ...(job.output ?? {}),
      recoveryCount,
      recoveredAt: new Date().toISOString(),
      recoveredBy: `${AiJobRecoveryService.name}:${options.source}`,
      previousError: job.error ?? undefined,
    };

    const claimResult = (await this.agentJobRepository.query(
      `UPDATE "agent_jobs"
       SET "status" = $1,
           "attempts" = 0,
           "max_attempts" = $2,
           "queue_job_id" = $3,
           "queue_name" = $4,
           "error" = NULL,
           "failed_at" = NULL,
           "locked_at" = NULL,
           "output" = $5::jsonb,
           "updated_at" = NOW()
       WHERE "id" = $6
         AND "status" = $7
         AND ($8::timestamptz IS NULL OR "failed_at" <= $8::timestamptz)
       RETURNING "id"`,
      [
        'queued',
        AI_QUEUE_JOB_OPTIONS.attempts,
        queueJobId,
        payload.queueName,
        JSON.stringify(output),
        job.id,
        'failed',
        options.cutoff ?? null,
      ],
    )) as unknown;
    const claim = Array.isArray(claimResult) ? claimResult : [];

    if (!claim.length) return false;

    try {
      await payload.add(queueJobId);
      this.logger.log(
        `Requeued failed AI job ${job.id} (${job.jobType}) by ${options.source} retry`,
      );
      return true;
    } catch (error) {
      await this.agentJobRepository.update(job.id, {
        status: 'failed',
        error: `Recovery requeue failed: ${this.getErrorMessage(error)}`,
        failedAt: new Date(),
        lockedAt: null,
      });
      this.logger.error(
        `Failed to requeue AI job ${job.id}: ${this.getErrorMessage(error)}`,
      );
      if (options.source === 'manual') {
        throw new BadRequestException(
          `Could not requeue agent job: ${this.getErrorMessage(error)}`,
        );
      }
      return false;
    }
  }

  private toQueuePayload(job: AgentJob): {
    queueName: string;
    add: (queueJobId: string) => Promise<unknown>;
  } | null {
    switch (job.jobType) {
      case AI_JOB_TYPES.CV_EXTRACTION: {
        const input = this.asRecord(job.input);
        if (
          !this.isString(input.userId) ||
          !this.isString(input.profileId) ||
          !this.isString(input.cvUrl)
        ) {
          return null;
        }
        const data: CvExtractionJobData = {
          agentJobId: job.id,
          userId: input.userId,
          profileId: input.profileId,
          cvUrl: input.cvUrl,
        };
        return {
          queueName: QUEUES.CV_EXTRACTION,
          add: (queueJobId) =>
            this.cvExtractionQueue.add(JOBS.EXTRACT_CV, data, {
              ...AI_QUEUE_JOB_OPTIONS,
              jobId: queueJobId,
            }),
        };
      }
      case AI_JOB_TYPES.ASSESSMENT_GENERATION: {
        const input = this.asRecord(job.input);
        if (
          !this.isString(input.userId) ||
          !this.isString(input.profileId) ||
          !this.isString(input.cvUrl) ||
          !this.isNumber(input.questionCount) ||
          !this.isNumber(input.durationSeconds)
        ) {
          return null;
        }
        const data: AssessmentGenerationJobData = {
          agentJobId: job.id,
          userId: input.userId,
          profileId: input.profileId,
          cvUrl: input.cvUrl,
          questionCount: input.questionCount,
          durationSeconds: input.durationSeconds,
        };
        return {
          queueName: QUEUES.ASSESSMENT_GENERATION,
          add: (queueJobId) =>
            this.assessmentGenerationQueue.add(JOBS.GENERATE_ASSESSMENT, data, {
              ...AI_QUEUE_JOB_OPTIONS,
              jobId: queueJobId,
            }),
        };
      }
      case AI_JOB_TYPES.PROFILE_EMBEDDING: {
        const input = this.asRecord(job.input);
        const assessmentId = input.assessmentId ?? null;
        if (
          !this.isString(input.userId) ||
          !this.isString(input.profileId) ||
          (assessmentId !== null && !this.isString(assessmentId)) ||
          !this.isString(input.reason)
        ) {
          return null;
        }
        const data: ProfileEmbeddingJobData = {
          agentJobId: job.id,
          userId: input.userId,
          profileId: input.profileId,
          assessmentId,
          reason: input.reason,
        };
        return {
          queueName: QUEUES.PROFILE_EMBEDDING,
          add: (queueJobId) =>
            this.profileEmbeddingQueue.add(
              JOBS.GENERATE_PROFILE_EMBEDDING,
              data,
              {
                ...AI_QUEUE_JOB_OPTIONS,
                jobId: queueJobId,
              },
            ),
        };
      }
      default:
        return null;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  private isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private getRecoveryCount(output: Record<string, unknown> | null) {
    const value = output?.recoveryCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
