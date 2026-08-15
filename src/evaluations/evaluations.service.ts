import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, QueryFailedError, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AiService } from 'src/agents/ai.service';
import type { EvaluateSubmissionResult } from 'src/agents/ai.service';
import type { EvaluateSubmissionDto } from 'src/agents/dto/EvaluateSubmissionDto';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';
import { AI_JOB_RETRY } from 'src/queues/queue.constants';
import type { SubmissionEvaluationJobData } from 'src/queues/queue.types';
import { Brief } from 'src/projects/entities/brief.entity';
import { EvaluationRun } from 'src/projects/entities/evaluation-run.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectSpec } from 'src/projects/entities/project-spec.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { QueueEvaluationDto } from './dtos/queue-evaluation.dto';
import { RetryEvaluationDto } from './dtos/retry-evaluation.dto';
import type {
  SubmissionEvaluationDispatcher,
  SubmissionEvaluationDispatchResult,
} from 'src/delivery/submission-evaluation-dispatcher';

interface Requester {
  userId: string;
  role: UserRole;
}

const ACTIVE_RUN_STATUSES = ['queued', 'running', 'completed'];

@Injectable()
export class EvaluationsService implements SubmissionEvaluationDispatcher {
  private readonly logger = new Logger(EvaluationsService.name);

  constructor(
    @InjectRepository(EvaluationRun)
    private readonly runRepo: Repository<EvaluationRun>,
    @InjectRepository(ProjectSubmission)
    private readonly submissionRepo: Repository<ProjectSubmission>,
    @InjectRepository(ProjectTask)
    private readonly taskRepo: Repository<ProjectTask>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(ProjectSpec)
    private readonly specRepo: Repository<ProjectSpec>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(AgentJob)
    private readonly agentJobRepo: Repository<AgentJob>,
    private readonly aiJobsProducer: AiJobsProducer,
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async queueSubmissionEvaluation(input: {
    submissionId: string;
    projectId: string;
    taskId: string;
    requestedBy: string;
  }): Promise<SubmissionEvaluationDispatchResult> {
    const result = await this.queueForSubmission(
      input.submissionId,
      { mode: 'async', reason: 'submission_submitted' },
      input.requestedBy,
    );
    return {
      evaluationRunId: result.evaluationRunId,
      agentJobId: result.agentJobId,
    };
  }

  // ---------------------------------------------------------------------------
  // Queue / retry (admin)
  // ---------------------------------------------------------------------------

  async queueForSubmission(
    submissionId: string,
    dto: QueueEvaluationDto,
    adminUserId: string,
  ) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    this.logger.log(
      `Queue evaluation for submission ${submissionId} (reason=${dto.reason ?? 'manual'}, by=${adminUserId})`,
    );

    const existing = await this.runRepo.findOne({
      where: { submissionId },
      order: { createdAt: 'DESC' },
    });
    if (existing && ACTIVE_RUN_STATUSES.includes(existing.status)) {
      return {
        evaluationRunId: existing.id,
        agentJobId: existing.agentJobId,
        status: existing.status,
        reused: true,
      };
    }

    let run: EvaluationRun;
    try {
      run = await this.runRepo.save(
        this.runRepo.create({
          projectId: submission.projectId,
          submissionId: submission.id,
          taskId: submission.taskId,
          milestoneId: submission.milestoneId,
          status: 'queued',
          promptVersion: 'submission-evaluation-v1',
        }),
      );
    } catch (error) {
      // A concurrent request may have created the active run first; the partial
      // unique index rejects the duplicate — reuse the winner instead.
      const active = await this.findActiveRun(submissionId);
      if (this.isUniqueViolation(error) && active) {
        return {
          evaluationRunId: active.id,
          agentJobId: active.agentJobId,
          status: active.status,
          reused: true,
        };
      }
      throw error;
    }

    return this.enqueueRun(run, submission);
  }

  async retryRun(
    evaluationRunId: string,
    dto: RetryEvaluationDto,
    adminUserId: string,
  ) {
    const run = await this.runRepo.findOne({
      where: { id: evaluationRunId },
    });
    if (!run) throw new NotFoundException('Evaluation run not found');
    this.logger.log(
      `Retry evaluation run ${evaluationRunId} (reason=${dto.reason ?? 'manual'}, by=${adminUserId})`,
    );

    const submission = await this.submissionRepo.findOne({
      where: { id: run.submissionId ?? '' },
    });
    if (!submission) {
      throw new NotFoundException('Submission for this run no longer exists');
    }

    // Another run may already be active for this submission (the partial unique
    // index allows only one). Refuse rather than 409 on the DB constraint.
    const sibling = await this.findActiveSiblingRun(run.submissionId, run.id);
    if (sibling) {
      throw new ConflictException(
        'Another evaluation run is already active for this submission',
      );
    }

    // Cancel the run's previous agent job so the recovery scanner cannot later
    // resurrect it as a duplicate of the new one.
    await this.cancelAgentJob(run.agentJobId, 'superseded_by_retry');

    run.status = 'queued';
    run.error = null;
    run.startedAt = null;
    run.completedAt = null;
    await this.runRepo.save(run);

    return this.enqueueRun(run, submission);
  }

  private async enqueueRun(run: EvaluationRun, submission: ProjectSubmission) {
    try {
      const agentJob =
        await this.aiJobsProducer.emitSubmissionEvaluationRequested({
          evaluationRunId: run.id,
          submissionId: submission.id,
          projectId: submission.projectId,
          taskId: submission.taskId,
        });
      run.agentJobId = agentJob.id;
      await this.runRepo.save(run);
      return {
        evaluationRunId: run.id,
        agentJobId: agentJob.id,
        status: 'queued',
      };
    } catch (error) {
      run.status = 'failed';
      run.error = this.getErrorMessage(error);
      await this.runRepo.save(run);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Worker path
  // ---------------------------------------------------------------------------

  async processSubmissionEvaluation(
    data: SubmissionEvaluationJobData,
    attemptsMade: number,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    await this.markJobRunning(data.agentJobId, attemptsMade, maxAttempts);

    try {
      const run = await this.runRepo.findOne({
        where: { id: data.evaluationRunId },
      });
      if (!run || run.submissionId !== data.submissionId) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'stale_submission_evaluation_job',
        });
        return;
      }
      if (run.status === 'completed') {
        await this.markJobCompleted(data.agentJobId, {
          evaluationRunId: run.id,
          alreadyCompleted: true,
        });
        return;
      }

      const submission = await this.submissionRepo.findOne({
        where: { id: data.submissionId },
      });
      if (!submission) {
        await this.markEvaluationRunFailed(run, 'Submission no longer exists');
        await this.markJobCancelled(data.agentJobId, {
          reason: 'submission_deleted',
        });
        return;
      }

      // A newer run may have become active for this submission (e.g. a recovery
      // requeue of a stale job). Supersede instead of fighting the unique index.
      const sibling = await this.findActiveSiblingRun(run.submissionId, run.id);
      if (sibling) {
        await this.markEvaluationRunFailed(
          run,
          'Superseded by a newer evaluation run',
        );
        await this.markJobCancelled(data.agentJobId, {
          reason: 'superseded_by_active_run',
        });
        return;
      }

      run.status = 'running';
      run.startedAt = run.startedAt ?? new Date();
      await this.runRepo.save(run);

      const payload = await this.buildEvaluationPayload(submission);
      const result = await this.aiService.evaluateSubmission(payload);

      await this.saveEvaluationResult(run, result);
      await this.notifySubmissionOwner(submission, result);

      await this.markJobCompleted(data.agentJobId, {
        evaluationRunId: run.id,
        submissionId: run.submissionId,
        recommendation: run.recommendation,
      });
    } catch (error) {
      if (this.isFinalAttempt(attemptsMade, maxAttempts)) {
        await this.markEvaluationRunFailedById(
          data.evaluationRunId,
          this.getErrorMessage(error),
        );
        await this.markJobFailed(data.agentJobId, error, maxAttempts);
      } else {
        await this.markJobRetrying(
          data.agentJobId,
          error,
          attemptsMade,
          maxAttempts,
        );
      }
      throw error;
    }
  }

  private async buildEvaluationPayload(
    submission: ProjectSubmission,
  ): Promise<EvaluateSubmissionDto> {
    const [project, task, brief, spec] = await Promise.all([
      this.projectRepo.findOne({ where: { id: submission.projectId } }),
      submission.taskId
        ? this.taskRepo.findOne({ where: { id: submission.taskId } })
        : Promise.resolve(null),
      this.briefRepo.findOne({ where: { projectId: submission.projectId } }),
      this.specRepo.findOne({ where: { projectId: submission.projectId } }),
    ]);

    return {
      project: {
        projectId: submission.projectId,
        title: project?.title ?? null,
      },
      task: this.buildTaskPayload(task, submission),
      submission: this.buildSubmissionArtifact(submission),
      brief: brief
        ? {
            briefId: brief.id,
            summary: brief.summary,
            projectType: brief.projectType,
            domain: brief.domain,
            acceptanceCriteria: this.toStringArray(brief.acceptanceCriteria),
          }
        : null,
      projectSpec: spec
        ? {
            architecture: spec.architecture,
            designSystem: spec.designSystem,
            apiContract: spec.apiContract,
            dataModel: spec.dataModel,
            conventions: spec.conventions,
          }
        : null,
    };
  }

  private buildTaskPayload(
    task: ProjectTask | null,
    submission: ProjectSubmission,
  ): EvaluateSubmissionDto['task'] {
    if (!task) {
      return {
        taskId: submission.taskId ?? submission.id,
        title: submission.title ?? 'Deliverable',
        description: submission.summary ?? '',
        isSpecTask: false,
        deliverables: [],
        acceptanceCriteria: [],
      };
    }
    const metadata = this.asRecord(task.metadata);
    return {
      taskId: task.id,
      title: task.title,
      description: task.description ?? '',
      isSpecTask: metadata.isSpecTask === true || metadata.type === 'spec',
      deliverables: this.toStringArray(metadata.deliverables),
      acceptanceCriteria: this.toStringArray(task.acceptanceCriteria),
    };
  }

  private buildSubmissionArtifact(
    submission: ProjectSubmission,
  ): EvaluateSubmissionDto['submission'] {
    const submissionText = this.extractSubmissionText(submission);
    const firstFileUrl = this.firstFileUrl(submission.fileUrls);
    const submissionType = this.toEvaluationSubmissionType(
      submission.submissionType,
      firstFileUrl,
    );

    return {
      submissionId: submission.id,
      submissionType,
      submissionUrl:
        submission.pullRequestUrl ?? submission.repoUrl ?? firstFileUrl,
      repositoryUrl: submission.repoUrl,
      pullRequestUrl: submission.pullRequestUrl,
      commitSha: submission.commitSha,
      submissionText,
      notes: submission.summary,
    };
  }

  private toEvaluationSubmissionType(
    submissionType: string,
    fileUrl: string | null,
  ): EvaluateSubmissionDto['submission']['submissionType'] {
    if (submissionType === 'repository') return 'repo';
    if (submissionType !== 'file') return submissionType;

    const pathname = fileUrl?.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
    if (pathname.endsWith('.pdf')) return 'pdf';
    if (pathname.endsWith('.zip')) return 'zip';
    return 'other';
  }

  private async saveEvaluationResult(
    run: EvaluationRun,
    result: EvaluateSubmissionResult,
  ) {
    const recommendation = result.requiresHumanReview
      ? 'manual_review'
      : result.passed
        ? 'approve'
        : 'changes_requested';
    const metCount = result.rubric.filter((item) => item.met).length;

    run.status = 'completed';
    run.score = String(result.score);
    run.recommendation = recommendation;
    run.summary =
      result.revisionNotes ||
      (result.passed ? 'Submission meets the acceptance criteria.' : null);
    run.findings = {
      passed: result.passed,
      revisionRequested: result.revisionRequested,
      requiresHumanReview: result.requiresHumanReview,
      revisionNotes: result.revisionNotes,
      rubric: result.rubric,
      source: result.source,
    };
    run.acceptanceCoverage = {
      total: result.rubric.length,
      met: metCount,
      unmet: result.rubric.length - metCount,
      items: result.rubric,
    };
    run.riskFlags = [
      ...(result.requiresHumanReview ? ['requires_human_review'] : []),
      ...(result.revisionRequested ? ['revision_requested'] : []),
    ];
    run.modelName = result.source;
    run.completedAt = new Date();
    await this.runRepo.save(run);
  }

  private async notifySubmissionOwner(
    submission: ProjectSubmission,
    result: EvaluateSubmissionResult,
  ) {
    if (!submission.freelancerProfileId) return;
    const profile = await this.profileRepo.findOne({
      where: { id: submission.freelancerProfileId },
    });
    if (!profile) return;

    await this.notificationsService.createNotification({
      userId: profile.userId,
      projectId: submission.projectId,
      title: 'Submission evaluated',
      body: result.passed
        ? 'The AI evaluation of your submission passed. Admin review is next.'
        : 'The AI evaluation of your submission requested changes. Check the feedback.',
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async listForSubmission(submissionId: string, requester: Requester) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.assertSubmissionVisibility(submission, requester);

    const runs = await this.runRepo.find({
      where: { submissionId },
      order: { createdAt: 'DESC' },
    });
    return runs.map((run) => this.toRunView(run, requester));
  }

  async getRun(evaluationRunId: string, requester: Requester) {
    const run = await this.runRepo.findOne({
      where: { id: evaluationRunId },
    });
    if (!run) throw new NotFoundException('Evaluation run not found');

    if (run.submissionId) {
      const submission = await this.submissionRepo.findOne({
        where: { id: run.submissionId },
      });
      if (submission)
        await this.assertSubmissionVisibility(submission, requester);
    } else if (requester.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You cannot access this evaluation run');
    }

    return this.toRunView(run, requester, true);
  }

  async adminList(query: {
    status?: string;
    recommendation?: string;
    projectId?: string;
    submissionId?: string;
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.recommendation) where.recommendation = query.recommendation;
    if (query.projectId) where.projectId = query.projectId;
    if (query.submissionId) where.submissionId = query.submissionId;

    const [runs, total] = await this.runRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const data = runs.map((run) =>
      this.toRunView(run, { role: UserRole.ADMIN, userId: '' }, true),
    );
    return { data, total };
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------

  private async assertSubmissionVisibility(
    submission: ProjectSubmission,
    requester: Requester,
  ) {
    if (requester.role === UserRole.ADMIN) return;

    if (requester.role === UserRole.CUSTOMER) {
      const project = await this.projectRepo.findOne({
        where: { id: submission.projectId },
      });
      if (!project || project.customerId !== requester.userId) {
        throw new ForbiddenException('You can only access your own project');
      }
      return;
    }

    if (requester.role === UserRole.FREELANCER) {
      const profile = await this.profileRepo.findOne({
        where: { userId: requester.userId },
      });
      if (!profile || submission.freelancerProfileId !== profile.id) {
        throw new ForbiddenException('You can only access your own submission');
      }
      return;
    }

    throw new ForbiddenException('You cannot access this submission');
  }

  private toRunView(
    run: EvaluationRun,
    requester: Requester,
    detailed = false,
  ) {
    const base = {
      id: run.id,
      projectId: run.projectId,
      submissionId: run.submissionId,
      taskId: run.taskId,
      milestoneId: run.milestoneId,
      status: run.status,
      score: run.score,
      recommendation: run.recommendation,
      summary: run.summary,
      requiresHumanReview: Boolean(
        run.riskFlags?.includes('requires_human_review'),
      ),
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    };
    if (!detailed) return base;
    const isAdmin = requester.role === UserRole.ADMIN;
    return {
      ...base,
      acceptanceCoverage: run.acceptanceCoverage,
      riskFlags: run.riskFlags,
      // Rubric feedback is for the owner; the `source` provenance is admin-only.
      findings: this.viewFindings(run.findings, isAdmin),
      modelName: isAdmin ? run.modelName : undefined,
      promptVersion: isAdmin ? run.promptVersion : undefined,
      agentJobId: isAdmin ? run.agentJobId : undefined,
      error: isAdmin ? run.error : undefined,
      startedAt: run.startedAt,
    };
  }

  private viewFindings(
    findings: Record<string, unknown> | null,
    isAdmin: boolean,
  ): Record<string, unknown> | null {
    if (!findings || isAdmin) return findings;
    const safe = { ...findings };
    delete safe.source;
    return safe;
  }

  // ---------------------------------------------------------------------------
  // Agent-job lifecycle (mirrors FreelancerAiJobsService)
  // ---------------------------------------------------------------------------

  private async markJobRunning(
    agentJobId: string,
    attemptsMade: number,
    maxAttempts: number,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'running',
      attempts: attemptsMade + 1,
      maxAttempts,
      lockedAt: new Date(),
      startedAt: new Date(),
      error: null,
      failedAt: null,
    });
  }

  private async markJobCompleted(
    agentJobId: string,
    output: Record<string, unknown>,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'completed',
      output: output as QueryDeepPartialEntity<AgentJob>['output'],
      completedAt: new Date(),
      lockedAt: null,
      error: null,
    });
  }

  private async markJobCancelled(
    agentJobId: string,
    output: Record<string, unknown>,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'cancelled',
      output: output as QueryDeepPartialEntity<AgentJob>['output'],
      completedAt: new Date(),
      lockedAt: null,
    });
  }

  private async markJobFailed(
    agentJobId: string,
    error: unknown,
    maxAttempts: number,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'failed',
      error: this.getErrorMessage(error),
      failedAt: new Date(),
      maxAttempts,
      lockedAt: null,
    });
  }

  private async markJobRetrying(
    agentJobId: string,
    error: unknown,
    attemptsMade: number,
    maxAttempts: number,
  ) {
    await this.agentJobRepo.update(agentJobId, {
      status: 'queued',
      error: this.getErrorMessage(error),
      lockedAt: null,
      output: {
        retrying: true,
        attempt: attemptsMade + 1,
        maxAttempts,
      },
    });
  }

  private async markEvaluationRunFailed(run: EvaluationRun, message: string) {
    run.status = 'failed';
    run.error = message;
    run.completedAt = new Date();
    await this.runRepo.save(run);
  }

  private async markEvaluationRunFailedById(runId: string, message: string) {
    await this.runRepo.update(runId, {
      status: 'failed',
      error: message,
      completedAt: new Date(),
    });
  }

  private isFinalAttempt(attemptsMade: number, maxAttempts: number) {
    return attemptsMade + 1 >= maxAttempts;
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  private extractSubmissionText(submission: ProjectSubmission): string | null {
    const content = submission.content;
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
      const record = content;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.body === 'string') return record.body;
      const serialized = JSON.stringify(record);
      return serialized === '{}' ? null : serialized.slice(0, 8000);
    }
    return submission.summary ?? null;
  }

  private firstFileUrl(
    fileUrls: Record<string, unknown> | null,
  ): string | null {
    if (!fileUrls) return null;
    for (const value of Object.values(fileUrls)) {
      if (typeof value === 'string' && value) return value;
      if (Array.isArray(value)) {
        const first = (value as unknown[]).find(
          (item) => typeof item === 'string' && item,
        );
        if (typeof first === 'string') return first;
      }
    }
    return null;
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (value && typeof value === 'object') {
      const items = (value as Record<string, unknown>).items;
      if (Array.isArray(items)) {
        return items.filter((item): item is string => typeof item === 'string');
      }
    }
    return [];
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async findActiveRun(submissionId: string) {
    return this.runRepo.findOne({
      where: { submissionId, status: In(ACTIVE_RUN_STATUSES) },
      order: { createdAt: 'DESC' },
    });
  }

  private async findActiveSiblingRun(
    submissionId: string | null,
    excludeRunId: string,
  ) {
    if (!submissionId) return null;
    return this.runRepo.findOne({
      where: {
        submissionId,
        status: In(ACTIVE_RUN_STATUSES),
        id: Not(excludeRunId),
      },
    });
  }

  private async cancelAgentJob(agentJobId: string | null, reason: string) {
    if (!agentJobId) return;
    await this.markJobCancelled(agentJobId, { reason });
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const code = (
      error as QueryFailedError & { driverError?: { code?: string } }
    ).driverError?.code;
    return code === '23505';
  }

  private getErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1000);
  }
}
