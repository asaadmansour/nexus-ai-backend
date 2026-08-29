import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DeepPartial, Repository } from 'typeorm';
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
  PlanningSubmissionEvaluationJobData,
  ProjectPlanGenerationJobData,
  SubmissionEvaluationJobData,
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
    @Optional()
    @InjectQueue(QUEUES.PLANNING_SUBMISSION_EVALUATION)
    private readonly planningSubmissionEvaluationQueue: Queue<PlanningSubmissionEvaluationJobData> | null,
    @Optional()
    @InjectQueue(QUEUES.SUBMISSION_EVALUATION)
    private readonly submissionEvaluationQueue: Queue<SubmissionEvaluationJobData> | null,
    @InjectRepository(AgentJob)
    private readonly agentJobRepository: Repository<AgentJob>,
  ) {}

  async emitPlanningSubmissionEvaluationRequested(input: {
    submissionId: string;
    projectId: string;
    requestedBy?: string | null;
  }) {
    const prepared = await this.saveIdempotentJob({
      agentName: AI_JOB_TYPES.PLANNING_SUBMISSION_EVALUATION,
      jobType: AI_JOB_TYPES.PLANNING_SUBMISSION_EVALUATION,
      idempotencyKey: this.idempotencyKey(
        AI_JOB_TYPES.PLANNING_SUBMISSION_EVALUATION,
        input.submissionId,
      ),
      projectId: input.projectId,
      submissionId: input.submissionId,
      userId: input.requestedBy ?? null,
      status: 'queued',
      maxAttempts: AI_JOB_RETRY.ATTEMPTS,
      queueName: QUEUES.PLANNING_SUBMISSION_EVALUATION,
      input: {
        submissionId: input.submissionId,
        projectId: input.projectId,
        requestedBy: input.requestedBy ?? null,
      },
    });
    const agentJob = prepared.job;
    if (prepared.reused) return agentJob;

    try {
      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
      await this.getQueue(
        this.planningSubmissionEvaluationQueue,
        QUEUES.PLANNING_SUBMISSION_EVALUATION,
      ).add(
        JOBS.EVALUATE_PLANNING_SUBMISSION,
        {
          agentJobId: agentJob.id,
          submissionId: input.submissionId,
          projectId: input.projectId,
          requestedBy: input.requestedBy ?? null,
        },
        { ...AI_QUEUE_JOB_OPTIONS, jobId: agentJob.id },
      );
      return agentJob;
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
  }

  async prepareSubmissionEvaluationRequested(
    input: {
      evaluationRunId: string;
      submissionId: string;
      projectId: string;
      taskId?: string | null;
    },
    repository: Repository<AgentJob> = this.agentJobRepository,
  ) {
    const prepared = await this.saveIdempotentJob(
      {
        agentName: AI_JOB_TYPES.SUBMISSION_EVALUATION,
        jobType: AI_JOB_TYPES.SUBMISSION_EVALUATION,
        idempotencyKey: this.idempotencyKey(
          AI_JOB_TYPES.SUBMISSION_EVALUATION,
          input.evaluationRunId,
        ),
        projectId: input.projectId,
        projectSubmissionId: input.submissionId,
        taskId: input.taskId ?? null,
        status: 'queued',
        maxAttempts: AI_JOB_RETRY.ATTEMPTS,
        queueName: QUEUES.SUBMISSION_EVALUATION,
        input: {
          evaluationRunId: input.evaluationRunId,
          submissionId: input.submissionId,
          projectId: input.projectId,
          taskId: input.taskId ?? null,
        },
      },
      repository,
    );
    return prepared.job;
  }

  async dispatchPreparedSubmissionEvaluation(
    agentJob: AgentJob,
    queueJobId: string = agentJob.id,
  ) {
    const data = this.readSubmissionEvaluationData(agentJob);

    try {
      agentJob.queueJobId = queueJobId;
      await this.agentJobRepository.save(agentJob);
      await this.getQueue(
        this.submissionEvaluationQueue,
        QUEUES.SUBMISSION_EVALUATION,
      ).add(JOBS.EVALUATE_SUBMISSION, data, {
        ...AI_QUEUE_JOB_OPTIONS,
        jobId: queueJobId,
      });
      return agentJob;
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
  }

  async getSubmissionEvaluationQueueState(agentJob: AgentJob): Promise<string> {
    const queue = this.getQueue(
      this.submissionEvaluationQueue,
      QUEUES.SUBMISSION_EVALUATION,
    );
    const queueJob = await queue.getJob(agentJob.queueJobId ?? agentJob.id);
    return queueJob ? queueJob.getState() : 'missing';
  }

  async ensureProjectPlanGenerationDispatch(agentJob: AgentJob) {
    const queue = this.getQueue(
      this.projectPlanGenerationQueue,
      QUEUES.PROJECT_PLAN_GENERATION,
    );
    const currentJobId = agentJob.queueJobId ?? agentJob.id;
    const currentJob = await queue.getJob(currentJobId);
    const currentState = currentJob ? await currentJob.getState() : 'missing';
    if (
      [
        'waiting',
        'active',
        'delayed',
        'prioritized',
        'waiting-children',
      ].includes(currentState)
    ) {
      return {
        recovered: false,
        state: currentState,
        queueJobId: currentJobId,
      };
    }

    const recoveryCount = this.getRecoveryCount(agentJob.output) + 1;
    const queueJobId = `${agentJob.id}-dispatch-${recoveryCount}`;
    const data = this.readProjectPlanGenerationData(agentJob);
    agentJob.status = 'queued';
    agentJob.queueJobId = queueJobId;
    agentJob.attempts = 0;
    agentJob.error = null;
    agentJob.failedAt = null;
    agentJob.lockedAt = null;
    agentJob.output = {
      ...(agentJob.output ?? {}),
      recoveryCount,
      recoveredAt: new Date().toISOString(),
      recoveredFromQueueState: currentState,
    };
    await this.agentJobRepository.save(agentJob);
    try {
      // Persist the dispatch identity first. A fast worker can now safely mark
      // this row running/completed without a later producer save reverting it.
      await queue.add(JOBS.GENERATE_PROJECT_PLAN, data, {
        ...AI_QUEUE_JOB_OPTIONS,
        jobId: queueJobId,
      });
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
    return { recovered: true, state: 'waiting', queueJobId };
  }

  async emitCvUploaded(input: {
    userId: string;
    profileId: string;
    cvUrl: string;
  }) {
    const prepared = await this.saveIdempotentJob({
      agentName: AI_JOB_TYPES.CV_EXTRACTION,
      jobType: AI_JOB_TYPES.CV_EXTRACTION,
      idempotencyKey: this.idempotencyKey(
        AI_JOB_TYPES.CV_EXTRACTION,
        input.profileId,
        input.cvUrl,
      ),
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
    });
    const agentJob = prepared.job;
    if (prepared.reused) return agentJob;

    try {
      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
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
    const prepared = await this.saveIdempotentJob({
      agentName: AI_JOB_TYPES.ASSESSMENT_GENERATION,
      jobType: AI_JOB_TYPES.ASSESSMENT_GENERATION,
      idempotencyKey: this.idempotencyKey(
        AI_JOB_TYPES.ASSESSMENT_GENERATION,
        input.profileId,
        input.cvUrl,
      ),
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
    });
    const agentJob = prepared.job;
    if (prepared.reused) return agentJob;

    try {
      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
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
    const prepared = await this.saveIdempotentJob({
      agentName: AI_JOB_TYPES.PROFILE_EMBEDDING,
      jobType: AI_JOB_TYPES.PROFILE_EMBEDDING,
      idempotencyKey: this.idempotencyKey(
        AI_JOB_TYPES.PROFILE_EMBEDDING,
        input.profileId,
        input.assessmentId ?? 'no-assessment',
        input.reason,
      ),
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
    });
    const agentJob = prepared.job;
    if (prepared.reused) return agentJob;

    try {
      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
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
    const prepared = await this.saveIdempotentJob({
      agentName: AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
      jobType: AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
      idempotencyKey: this.idempotencyKey(
        AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
        input.projectId,
        input.architectureSubmissionId ?? 'no-architecture',
        input.uiuxSubmissionId ?? 'no-uiux',
        input.notes ?? '',
      ),
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
    });
    const agentJob = prepared.job;
    if (prepared.reused) return agentJob;

    try {
      // Link the durable row before publishing. Otherwise a fast worker can
      // complete and then be overwritten back to queued by the producer.
      agentJob.queueJobId = agentJob.id;
      await this.agentJobRepository.save(agentJob);
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
      return agentJob;
    } catch (error) {
      await this.markQueueAddFailed(agentJob, error);
      throw error;
    }
  }

  private async saveIdempotentJob(
    input: DeepPartial<AgentJob>,
    repository: Repository<AgentJob> = this.agentJobRepository,
  ) {
    const candidate = repository.create(input);
    try {
      return { job: await repository.save(candidate), reused: false };
    } catch (error) {
      if (this.databaseErrorCode(error) !== '23505' || !input.idempotencyKey) {
        throw error;
      }
      const active = await repository.findOne({
        where: {
          idempotencyKey: String(input.idempotencyKey),
        },
        order: { createdAt: 'DESC' },
      });
      if (!active) throw error;
      return { job: active, reused: true };
    }
  }

  private idempotencyKey(jobType: string, ...parts: string[]) {
    const digest = createHash('sha256')
      .update(JSON.stringify(parts))
      .digest('hex');
    return `${jobType}:${digest}`;
  }

  private databaseErrorCode(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const direct = (error as { code?: unknown }).code;
    if (typeof direct === 'string') return direct;
    const driver = (error as { driverError?: { code?: unknown } }).driverError;
    return typeof driver?.code === 'string' ? driver.code : null;
  }

  private getQueue<T>(queue: Queue<T> | null, queueName: string): Queue<T> {
    if (!queue) {
      throw new ServiceUnavailableException(
        `Queue system is disabled; cannot enqueue ${queueName}`,
      );
    }

    return queue;
  }

  private readSubmissionEvaluationData(
    agentJob: AgentJob,
  ): SubmissionEvaluationJobData {
    const input = agentJob.input;
    const evaluationRunId = input?.evaluationRunId;
    const submissionId = input?.submissionId;
    const projectId = input?.projectId;
    const taskId = input?.taskId ?? null;
    if (
      agentJob.jobType !== AI_JOB_TYPES.SUBMISSION_EVALUATION ||
      typeof evaluationRunId !== 'string' ||
      typeof submissionId !== 'string' ||
      typeof projectId !== 'string' ||
      (taskId !== null && typeof taskId !== 'string')
    ) {
      throw new Error(
        `Agent job ${agentJob.id} does not contain a valid submission evaluation payload`,
      );
    }
    return {
      agentJobId: agentJob.id,
      evaluationRunId,
      submissionId,
      projectId,
      taskId,
    };
  }

  private readProjectPlanGenerationData(
    agentJob: AgentJob,
  ): ProjectPlanGenerationJobData {
    const input = agentJob.input;
    const projectId = input?.projectId;
    const architectureSubmissionId = input?.architectureSubmissionId ?? null;
    const uiuxSubmissionId = input?.uiuxSubmissionId ?? null;
    const requestedBy = input?.requestedBy ?? null;
    const notes = input?.notes ?? null;
    if (
      agentJob.jobType !== AI_JOB_TYPES.PROJECT_PLAN_GENERATION ||
      typeof projectId !== 'string' ||
      (architectureSubmissionId !== null &&
        typeof architectureSubmissionId !== 'string') ||
      (uiuxSubmissionId !== null && typeof uiuxSubmissionId !== 'string') ||
      (requestedBy !== null && typeof requestedBy !== 'string') ||
      (notes !== null && typeof notes !== 'string')
    ) {
      throw new ServiceUnavailableException(
        'The saved project-plan job payload cannot be recovered',
      );
    }
    return {
      agentJobId: agentJob.id,
      projectId,
      architectureSubmissionId,
      uiuxSubmissionId,
      requestedBy,
      notes,
    };
  }

  private getRecoveryCount(output: Record<string, unknown> | null) {
    const value = output?.recoveryCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
