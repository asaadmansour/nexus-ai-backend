import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  LessThanOrEqual,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { EvaluateSubmissionResult } from 'src/agents/ai.service';
import type { EvaluateSubmissionDto } from 'src/agents/dto/EvaluateSubmissionDto';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';
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
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { QueueEvaluationDto } from './dtos/queue-evaluation.dto';
import { RetryEvaluationDto } from './dtos/retry-evaluation.dto';
import type {
  SubmissionEvaluationDispatcher,
  SubmissionEvaluationDispatchResult,
} from 'src/delivery/submission-evaluation-dispatcher';
import {
  buildImplementationEvaluationRubric,
  type ImplementationRubricSnapshot,
} from './submission-quality-criteria';
import { ImplementationEvaluationSandboxService } from './implementation-evaluation-sandbox.service';

interface Requester {
  userId: string;
  role: UserRole;
}

const ACTIVE_RUN_STATUSES = ['queued', 'running'];

@Injectable()
export class EvaluationsService implements SubmissionEvaluationDispatcher {
  private readonly logger = new Logger(EvaluationsService.name);

  constructor(
    private readonly dataSource: DataSource,
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
    private readonly implementationSandbox: ImplementationEvaluationSandboxService,
    private readonly notificationsService: NotificationsService,
    private readonly incidents: AutomationIncidentsService,
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
      return this.ensureActiveRunDispatch(existing, submission);
    }

    // Freeze the task-aware rubric on the first run for this submission. A
    // retry or GitHub follow-up must judge the same assignment by the same
    // criteria even if project metadata changes while the freelancer revises.
    const rubricSnapshot =
      this.readRubricSnapshot(existing?.acceptanceCoverage) ??
      (await this.buildRubricSnapshot(submission));

    let run: EvaluationRun;
    try {
      run = await this.runRepo.save(
        this.runRepo.create({
          projectId: submission.projectId,
          submissionId: submission.id,
          taskId: submission.taskId,
          milestoneId: submission.milestoneId,
          status: 'queued',
          promptVersion: 'submission-evaluation-v4-adaptive',
          trigger: dto.reason ?? 'manual',
          acceptanceCoverage: {
            total: rubricSnapshot.criteria.length,
            met: 0,
            notApplicable: 0,
            unmet: 0,
            pending: rubricSnapshot.criteria.length,
            items: [],
            rubricSnapshot,
          },
        }),
      );
    } catch (error) {
      // A concurrent request may have created the active run first; the partial
      // unique index rejects the duplicate — reuse the winner instead.
      const active = await this.findActiveRun(submissionId);
      if (this.isUniqueViolation(error) && active) {
        return this.ensureActiveRunDispatch(active, submission);
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
    if (ACTIVE_RUN_STATUSES.includes(run.status)) {
      return this.ensureActiveRunDispatch(run, submission);
    }

    // Another run may already be active for this submission (the partial unique
    // index allows only one). Refuse rather than 409 on the DB constraint.
    const sibling = await this.findActiveSiblingRun(run.submissionId, run.id);
    if (sibling) {
      throw new ConflictException(
        'Another evaluation run is already active for this submission',
      );
    }

    // Keep the previous run immutable: its verdict is part of the consistency
    // history supplied to the next evaluator. A retry is always a new run.
    return this.queueForSubmission(
      submission.id,
      {
        mode: 'async',
        reason: dto.reason ?? `retry_of_${run.id}`,
      },
      adminUserId,
    );
  }

  private async enqueueRun(run: EvaluationRun, submission: ProjectSubmission) {
    // The run must point at its agent job before BullMQ can expose the job to
    // a worker. Publishing first lets a fast worker observe agentJobId=null
    // and incorrectly cancel the only job as superseded.
    const dispatch = await this.ensureActiveRunDispatch(run, submission);
    return {
      evaluationRunId: dispatch.evaluationRunId,
      agentJobId: dispatch.agentJobId,
      status: dispatch.status,
    };
  }

  async recoverOrphanedRuns() {
    const cutoff = new Date(Date.now() - 30_000);
    const runs = await this.runRepo.find({
      where: {
        status: In(ACTIVE_RUN_STATUSES),
        updatedAt: LessThanOrEqual(cutoff),
      },
      order: { updatedAt: 'ASC' },
      take: 50,
    });
    let recovered = 0;
    for (const run of runs) {
      try {
        const submission = run.submissionId
          ? await this.submissionRepo.findOne({
              where: { id: run.submissionId },
            })
          : null;
        if (!submission) {
          await this.markEvaluationRunFailedById(
            run.id,
            'Submission no longer exists',
          );
          continue;
        }
        const result = await this.ensureActiveRunDispatch(run, submission);
        if (result.recovered) recovered += 1;
      } catch (error) {
        this.logger.error(
          `Could not reconcile evaluation run ${run.id}: ${this.getErrorMessage(error)}`,
        );
      }
    }
    return { inspected: runs.length, recovered };
  }

  private async ensureActiveRunDispatch(
    run: EvaluationRun,
    submission: ProjectSubmission,
  ): Promise<{
    evaluationRunId: string;
    agentJobId: string;
    status: string;
    reused: boolean;
    recovered?: boolean;
  }> {
    if (!ACTIVE_RUN_STATUSES.includes(run.status)) {
      throw new ConflictException('This evaluation run is no longer active');
    }

    const agentJob = run.agentJobId
      ? await this.agentJobRepo.findOne({ where: { id: run.agentJobId } })
      : null;
    if (agentJob) {
      const queueState =
        await this.aiJobsProducer.getSubmissionEvaluationQueueState(agentJob);
      if (
        [
          'active',
          'waiting',
          'delayed',
          'prioritized',
          'waiting-children',
        ].includes(queueState)
      ) {
        return {
          evaluationRunId: run.id,
          agentJobId: agentJob.id,
          status: run.status,
          reused: true,
        };
      }
    }

    const replacement =
      await this.aiJobsProducer.prepareSubmissionEvaluationRequested({
        evaluationRunId: run.id,
        submissionId: submission.id,
        projectId: submission.projectId,
        taskId: submission.taskId,
      });
    const linked = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(EvaluationRun);
      const current = await repository
        .createQueryBuilder('evaluationRun')
        .setLock('pessimistic_write')
        .where('evaluationRun.id = :runId', { runId: run.id })
        .getOne();
      if (
        !current ||
        !ACTIVE_RUN_STATUSES.includes(current.status) ||
        current.agentJobId !== run.agentJobId
      ) {
        return null;
      }
      current.agentJobId = replacement.id;
      current.status = 'queued';
      current.startedAt = null;
      current.completedAt = null;
      current.error = null;
      await repository.save(current);
      return current;
    });

    if (!linked) {
      await this.markJobCancelled(replacement.id, {
        reason: 'evaluation_dispatch_recovery_lost_race',
      });
      const current = await this.runRepo.findOne({ where: { id: run.id } });
      if (!current || !ACTIVE_RUN_STATUSES.includes(current.status)) {
        throw new ConflictException('This evaluation run is no longer active');
      }
      const currentJob = current.agentJobId
        ? await this.agentJobRepo.findOne({
            where: { id: current.agentJobId },
          })
        : null;
      if (!currentJob) {
        throw new ConflictException(
          'Evaluation dispatch changed concurrently; retry reconciliation',
        );
      }
      return {
        evaluationRunId: current.id,
        agentJobId: currentJob.id,
        status: current.status,
        reused: true,
      };
    }

    if (agentJob) {
      await this.markJobCancelled(agentJob.id, {
        reason: 'orphaned_evaluation_dispatch_replaced',
        replacementAgentJobId: replacement.id,
      });
    }
    try {
      await this.aiJobsProducer.dispatchPreparedSubmissionEvaluation(
        replacement,
      );
    } catch (error) {
      await this.runRepo
        .createQueryBuilder()
        .update(EvaluationRun)
        .set({
          status: 'failed',
          error: this.getErrorMessage(error),
          completedAt: new Date(),
        })
        .where('id = :runId', { runId: linked.id })
        .andWhere('agent_job_id = :agentJobId', {
          agentJobId: replacement.id,
        })
        .execute();
      throw error;
    }
    return {
      evaluationRunId: linked.id,
      agentJobId: replacement.id,
      status: 'queued',
      reused: true,
      recovered: true,
    };
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
      if (
        !ACTIVE_RUN_STATUSES.includes(run.status) ||
        run.agentJobId !== data.agentJobId
      ) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'superseded_evaluation_run',
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

      const payload = await this.buildEvaluationPayload(submission, run);
      const execution = await this.implementationSandbox.evaluate(
        payload,
        data.agentJobId,
      );
      const result = execution.result;
      const currentRun = await this.runRepo.findOne({
        where: { id: run.id },
      });
      if (
        !currentRun ||
        currentRun.status !== 'running' ||
        currentRun.agentJobId !== data.agentJobId
      ) {
        await this.markJobCancelled(data.agentJobId, {
          reason: 'superseded_during_evaluation',
        });
        return;
      }

      if (
        execution.evaluatedCommitSha &&
        submission.commitSha !== execution.evaluatedCommitSha
      ) {
        await this.submissionRepo
          .createQueryBuilder()
          .update(ProjectSubmission)
          .set({ commitSha: execution.evaluatedCommitSha })
          .where('id = :id', { id: submission.id })
          .andWhere('(commit_sha IS NULL OR commit_sha = :originalCommitSha)', {
            originalCommitSha: submission.commitSha,
          })
          .execute();
        submission.commitSha = execution.evaluatedCommitSha;
      }

      currentRun.evaluatedCommitSha = execution.evaluatedCommitSha;
      await this.applyRevisionVerdict(submission, currentRun, result);
      await this.saveEvaluationResult(
        currentRun,
        result,
        execution.auditBundle,
        execution.evaluatedCommitSha,
      );
      await this.notifySubmissionOwner(submission, result).catch(
        (error: unknown) =>
          this.logger.error(
            `Could not notify owner of submission ${submission.id}: ${this.getErrorMessage(error)}`,
          ),
      );
      await this.notifyPrincipalReviewer(submission, result).catch(
        (error: unknown) =>
          this.logger.error(
            `Could not notify principal reviewer for submission ${submission.id}: ${this.getErrorMessage(error)}`,
          ),
      );

      await this.markJobCompleted(data.agentJobId, {
        evaluationRunId: run.id,
        submissionId: run.submissionId,
        recommendation: currentRun.recommendation,
      });
      await this.queuePendingRepositoryEvaluation(
        submission.id,
        currentRun.id,
      ).catch((error: unknown) =>
        this.logger.error(
          `Could not queue pending GitHub re-evaluation for submission ${submission.id}: ${this.getErrorMessage(error)}`,
        ),
      );
    } catch (error) {
      if (this.isFinalAttempt(attemptsMade, maxAttempts)) {
        await this.markEvaluationRunFailedById(
          data.evaluationRunId,
          this.getErrorMessage(error),
        );
        await this.markJobFailed(data.agentJobId, error, maxAttempts);
        await this.notifyEvaluationFailure(
          data.projectId,
          data.taskId ?? null,
          this.getErrorMessage(error),
          error instanceof Error ? error.stack : undefined,
        ).catch(() => undefined);
        await this.queuePendingRepositoryEvaluation(
          data.submissionId,
          data.evaluationRunId,
        ).catch((queueError: unknown) =>
          this.logger.error(
            `Could not recover pending GitHub re-evaluation for submission ${data.submissionId}: ${this.getErrorMessage(queueError)}`,
          ),
        );
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
    currentRun: EvaluationRun,
  ): Promise<EvaluateSubmissionDto> {
    const [project, task, brief, spec, evaluationHistory] = await Promise.all([
      this.projectRepo.findOne({ where: { id: submission.projectId } }),
      submission.taskId
        ? this.taskRepo.findOne({ where: { id: submission.taskId } })
        : Promise.resolve(null),
      this.briefRepo.findOne({ where: { projectId: submission.projectId } }),
      this.specRepo.findOne({ where: { projectId: submission.projectId } }),
      submission.taskId
        ? this.runRepo.find({
            where: {
              projectId: submission.projectId,
              taskId: submission.taskId,
              status: 'completed',
              id: Not(currentRun.id),
            },
            order: { completedAt: 'DESC' },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    const submissionArtifact = this.buildSubmissionArtifact(submission);
    const projectSpec = this.buildProjectSpecPayload(spec);
    const rubricSnapshot =
      this.readRubricSnapshot(currentRun.acceptanceCoverage) ??
      buildImplementationEvaluationRubric({
        submissionType: submissionArtifact.submissionType,
        task: this.buildTaskRequirementInput(task, submission),
        projectSpec,
      });

    return {
      project: {
        projectId: submission.projectId,
        title: project?.title ?? null,
      },
      task: this.buildTaskPayload(
        task,
        submission,
        submissionArtifact.submissionType,
        rubricSnapshot,
      ),
      submission: submissionArtifact,
      brief: brief
        ? {
            briefId: brief.id,
            summary: brief.summary,
            projectType: brief.projectType,
            domain: brief.domain,
            acceptanceCriteria: this.toStringArray(brief.acceptanceCriteria),
          }
        : null,
      projectSpec,
      evaluationHistory: evaluationHistory.map((historyRun) => ({
        evaluationRunId: historyRun.id,
        submissionId: historyRun.submissionId,
        commitSha: historyRun.evaluatedCommitSha,
        score: historyRun.score,
        recommendation: historyRun.recommendation,
        summary: historyRun.summary,
        unmetCriteria: this.evaluationUnmetCriteria(historyRun),
        completedAt: historyRun.completedAt?.toISOString() ?? null,
      })),
    };
  }

  private evaluationUnmetCriteria(run: EvaluationRun): string[] {
    const items = run.acceptanceCoverage?.items;
    if (!Array.isArray(items)) return [];
    return (items as unknown[])
      .filter(
        (item: unknown): item is Record<string, unknown> =>
          Boolean(item) &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).met === false,
      )
      .map((item) => item.criterion)
      .filter((criterion): criterion is string => typeof criterion === 'string')
      .slice(0, 100);
  }

  private buildTaskPayload(
    task: ProjectTask | null,
    submission: ProjectSubmission,
    submissionType: string,
    frozenRubric?: ImplementationRubricSnapshot,
  ): EvaluateSubmissionDto['task'] {
    const taskInput = this.buildTaskRequirementInput(task, submission);
    const rubric =
      frozenRubric ??
      buildImplementationEvaluationRubric({
        submissionType,
        task: taskInput,
      });
    const qualityCriteria = rubric.criteria
      .filter((criterion) =>
        ['quality', 'verification', 'security', 'operations'].includes(
          criterion.category,
        ),
      )
      .map((criterion) => criterion.criterion);
    if (!task) {
      return {
        taskId: submission.taskId ?? submission.id,
        title: submission.title ?? 'Deliverable',
        description: submission.summary ?? '',
        isSpecTask: false,
        deliverables: [],
        acceptanceCriteria: [],
        integrationChecks: [],
        contractReferences: [],
        ownedPaths: [],
        evaluationCriteria: rubric.criteria,
        evaluationProfile: rubric.profile,
        qualityCriteria,
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
      integrationChecks: this.toStringArray(metadata.integrationChecks),
      contractReferences: this.toStringArray(metadata.contractReferences),
      ownedPaths: this.toStringArray(metadata.ownedPaths),
      evaluationCriteria: rubric.criteria,
      evaluationProfile: rubric.profile,
      qualityCriteria,
    };
  }

  private buildTaskRequirementInput(
    task: ProjectTask | null,
    submission: ProjectSubmission,
  ) {
    if (!task) {
      return {
        title: submission.title ?? 'Deliverable',
        description: submission.summary ?? '',
        deliverables: [] as string[],
        acceptanceCriteria: [] as string[],
        integrationChecks: [] as string[],
        contractReferences: [] as string[],
        ownedPaths: [] as string[],
      };
    }
    const metadata = this.asRecord(task.metadata);
    return {
      title: task.title,
      description: task.description ?? '',
      deliverables: this.toStringArray(metadata.deliverables),
      acceptanceCriteria: this.toStringArray(task.acceptanceCriteria),
      integrationChecks: this.toStringArray(metadata.integrationChecks),
      contractReferences: this.toStringArray(metadata.contractReferences),
      ownedPaths: this.toStringArray(metadata.ownedPaths),
    };
  }

  private buildProjectSpecPayload(
    spec: ProjectSpec | null,
  ): Record<string, unknown> | null {
    return spec
      ? {
          architecture: spec.architecture,
          designSystem: spec.designSystem,
          apiContract: spec.apiContract,
          dataModel: spec.dataModel,
          conventions: spec.conventions,
        }
      : null;
  }

  private async buildRubricSnapshot(
    submission: ProjectSubmission,
  ): Promise<ImplementationRubricSnapshot> {
    const [task, spec] = await Promise.all([
      submission.taskId
        ? this.taskRepo.findOne({ where: { id: submission.taskId } })
        : Promise.resolve(null),
      this.specRepo.findOne({ where: { projectId: submission.projectId } }),
    ]);
    const submissionType =
      this.buildSubmissionArtifact(submission).submissionType;
    return buildImplementationEvaluationRubric({
      submissionType,
      task: this.buildTaskRequirementInput(task, submission),
      projectSpec: this.buildProjectSpecPayload(spec),
    });
  }

  private readRubricSnapshot(
    coverage: Record<string, unknown> | null | undefined,
  ): ImplementationRubricSnapshot | null {
    const value = coverage?.rubricSnapshot;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.schemaVersion !== 1 ||
      !Array.isArray(candidate.criteria) ||
      !candidate.profile ||
      typeof candidate.profile !== 'object'
    ) {
      return null;
    }
    return value as ImplementationRubricSnapshot;
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
      repositoryId: submission.repositoryId,
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
    auditBundle: Record<string, unknown>,
    evaluatedCommitSha: string | null,
  ) {
    const recommendation = !result.passed
      ? 'changes_requested'
      : result.requiresHumanReview
        ? 'manual_review'
        : 'approve';
    const notApplicableCount = result.rubric.filter(
      (item) => item.status === 'not_applicable',
    ).length;
    const metCount = result.rubric.filter(
      (item) => item.met && item.status !== 'not_applicable',
    ).length;
    const unmetCount = result.rubric.filter((item) => !item.met).length;
    const rubricSnapshot = this.readRubricSnapshot(run.acceptanceCoverage);

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
      findings: result.findings,
      risks: result.risks,
      source: result.source,
    };
    run.acceptanceCoverage = {
      total: result.rubric.length,
      met: metCount,
      notApplicable: notApplicableCount,
      unmet: unmetCount,
      pending: 0,
      items: result.rubric,
      ...(rubricSnapshot ? { rubricSnapshot } : {}),
    };
    run.riskFlags = [
      ...(result.requiresHumanReview ? ['requires_human_review'] : []),
      ...(result.revisionRequested ? ['revision_requested'] : []),
    ];
    run.evaluatedCommitSha = evaluatedCommitSha;
    run.evidenceBundle = auditBundle;
    run.modelName = result.source;
    run.completedAt = new Date();
    await this.runRepo.save(run);
    await this.incidents.resolveOperation(
      'ai_jobs',
      'evaluate_implementation_submission',
      run.projectId,
      'A later implementation evaluation completed successfully.',
    );
  }

  private async applyRevisionVerdict(
    evaluatedSubmission: ProjectSubmission,
    run: EvaluationRun,
    result: EvaluateSubmissionResult,
  ) {
    if (result.passed) {
      await this.resolveAutomatedRevisionAfterPassing(evaluatedSubmission, run);
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      const submissionRepo = manager.getRepository(ProjectSubmission);
      const submission = await submissionRepo
        .createQueryBuilder('submission')
        .setLock('pessimistic_write')
        .where('submission.id = :submissionId', {
          submissionId: evaluatedSubmission.id,
        })
        .getOne();
      if (
        !submission ||
        !['submitted', 'under_review'].includes(submission.status)
      ) {
        return;
      }
      if (
        ['pull_request', 'repository'].includes(submission.submissionType) &&
        (!submission.commitSha ||
          !run.evaluatedCommitSha ||
          submission.commitSha.toLowerCase() !==
            run.evaluatedCommitSha.toLowerCase())
      ) {
        return;
      }

      submission.status = 'changes_requested';
      await submissionRepo.save(submission);
      if (submission.taskId) {
        await manager.getRepository(ProjectTask).update(submission.taskId, {
          status: 'changes_requested',
        });
      }

      const revisionRepo = manager.getRepository(ProjectRevisionRequest);
      const existing = await revisionRepo.findOne({
        where: {
          submissionId: submission.id,
          status: In(['open', 'in_progress']),
        },
      });
      if (existing) return;
      const unmetRubric = result.rubric.filter((item) => !item.met);
      await revisionRepo.save(
        revisionRepo.create({
          projectId: submission.projectId,
          milestoneId: submission.milestoneId,
          taskId: submission.taskId,
          submissionId: submission.id,
          requestedBy: null,
          assignedToFreelancerProfileId: submission.freelancerProfileId,
          status: 'open',
          priority: 'high',
          title: `Automated revision: ${submission.title ?? 'implementation submission'}`,
          description:
            result.revisionNotes ||
            'Address the unmet evaluation criteria and submit a new version.',
          requestedChanges: {
            evaluationRunId: run.id,
            rubric: unmetRubric,
            findings: result.findings,
            risks: result.risks,
          },
          metadata: {
            generatedBy: 'submission_evaluation_agent',
            evaluationRunId: run.id,
            evaluatedCommitSha: run.evaluatedCommitSha,
          },
          dueAt: null,
          resolvedAt: null,
        }),
      );
    });
  }

  private async resolveAutomatedRevisionAfterPassing(
    evaluatedSubmission: ProjectSubmission,
    run: EvaluationRun,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const submissionRepo = manager.getRepository(ProjectSubmission);
      const submission = await submissionRepo
        .createQueryBuilder('submission')
        .setLock('pessimistic_write')
        .where('submission.id = :submissionId', {
          submissionId: evaluatedSubmission.id,
        })
        .getOne();
      if (
        !submission ||
        submission.status !== 'changes_requested' ||
        !submission.commitSha ||
        !run.evaluatedCommitSha ||
        submission.commitSha.toLowerCase() !==
          run.evaluatedCommitSha.toLowerCase()
      ) {
        return;
      }

      const revisionRepo = manager.getRepository(ProjectRevisionRequest);
      const revisions = await revisionRepo.find({
        where: {
          submissionId: submission.id,
          status: In(['open', 'in_progress']),
        },
      });
      const evaluatedCommitSha = run.evaluatedCommitSha.toLowerCase();
      const automated = revisions.filter((revision) => {
        const metadata = revision.metadata ?? {};
        return (
          metadata.generatedBy === 'submission_evaluation_agent' &&
          typeof metadata.evaluatedCommitSha === 'string' &&
          metadata.evaluatedCommitSha.toLowerCase() === evaluatedCommitSha
        );
      });
      if (!automated.length) return;

      const resolvedAt = new Date();
      for (const revision of automated) {
        revision.status = 'resolved';
        revision.resolvedAt = resolvedAt;
        revision.metadata = {
          ...(revision.metadata ?? {}),
          resolvedByEvaluationRunId: run.id,
          resolution: 'automated_re_evaluation_passed',
          resolvedAt: resolvedAt.toISOString(),
        };
      }
      await revisionRepo.save(automated);
      submission.status = 'under_review';
      await submissionRepo.save(submission);
      if (submission.taskId) {
        await manager.getRepository(ProjectTask).update(submission.taskId, {
          status: 'review',
        });
      }
    });
  }

  async requeueForRepositoryUpdate(input: {
    submissionId: string;
    commitSha: string;
    reason: string;
    allowApprovedIntegrationRecovery?: boolean;
  }) {
    const commitSha = input.commitSha.toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(commitSha)) {
      throw new ConflictException(
        'GitHub webhook supplied an invalid commit SHA',
      );
    }

    const outcome = await this.dataSource.transaction(async (manager) => {
      const submissionRepo = manager.getRepository(ProjectSubmission);
      const submission = await submissionRepo
        .createQueryBuilder('submission')
        .setLock('pessimistic_write')
        .where('submission.id = :submissionId', {
          submissionId: input.submissionId,
        })
        .getOne();
      const integration = submission?.metadata?.integration;
      const approvedIntegrationRecovery = Boolean(
        submission &&
        submission.status === 'approved' &&
        input.allowApprovedIntegrationRecovery === true &&
        integration &&
        typeof integration === 'object' &&
        (integration as Record<string, unknown>).status === 'failed' &&
        submission.commitSha?.toLowerCase() !== commitSha,
      );
      if (
        !submission ||
        (!['submitted', 'under_review'].includes(submission.status) &&
          !approvedIntegrationRecovery)
      ) {
        return { kind: 'ignored' as const };
      }

      const runRepo = manager.getRepository(EvaluationRun);
      const activeRuns = await runRepo.find({
        where: {
          submissionId: submission.id,
          status: In(ACTIVE_RUN_STATUSES),
        },
      });
      const activeForSameCommit =
        submission.commitSha?.toLowerCase() === commitSha
          ? activeRuns[0]
          : undefined;

      const priorCommitSha = submission.commitSha;
      submission.commitSha = commitSha;
      submission.status = 'under_review';
      const metadata: Record<string, unknown> = {
        ...(submission.metadata ?? {}),
        githubEvaluationTrigger: {
          reason: input.reason,
          commitSha,
          receivedAt: new Date().toISOString(),
          coalescedIntoEvaluationRunId: activeForSameCommit?.id ?? null,
        },
      };
      if (approvedIntegrationRecovery) {
        metadata.integrationRecovery = {
          status: 'evaluation_pending',
          priorApprovedAt: submission.approvedAt?.toISOString() ?? null,
          priorReviewedAt: submission.reviewedAt?.toISOString() ?? null,
          priorReviewedBy: submission.reviewedBy,
          priorCommitSha,
          updatedCommitSha: commitSha,
          reopenedAt: new Date().toISOString(),
          reason: input.reason,
        };
        metadata.integration = {
          ...(integration as Record<string, unknown>),
          status: 'evaluation_pending',
          updatedCommitSha: commitSha,
          reopenedAt: new Date().toISOString(),
        };
        submission.reviewedBy = null;
        submission.reviewedAt = null;
        submission.approvedAt = null;
        submission.rejectedAt = null;
      }
      if (activeForSameCommit) {
        metadata.githubEvaluationPendingTrigger = {
          reason: input.reason,
          commitSha,
          evaluationRunId: activeForSameCommit.id,
          receivedAt: new Date().toISOString(),
        };
      } else {
        delete metadata.githubEvaluationPendingTrigger;
      }
      submission.metadata = metadata;
      await submissionRepo.save(submission);
      if (submission.taskId) {
        await manager.getRepository(ProjectTask).update(submission.taskId, {
          status: 'review',
          assignmentStatus: 'in_progress',
        });
      }

      // A push can generate several check/status webhooks for the same SHA. Let
      // the in-flight run finish instead of repeatedly cancelling expensive
      // sandbox work. A terminal event received after completion still creates
      // a fresh run so the final GitHub checks are captured.
      if (activeForSameCommit) {
        return {
          kind: 'reused' as const,
          run: activeForSameCommit,
        };
      }

      for (const active of activeRuns) {
        active.status = 'superseded';
        active.error = `Superseded by ${input.reason}`;
        active.completedAt = new Date();
      }
      if (activeRuns.length) await runRepo.save(activeRuns);
      return {
        kind: 'queue' as const,
        submissionId: submission.id,
        agentJobIds: activeRuns
          .map((active) => active.agentJobId)
          .filter((id): id is string => Boolean(id)),
      };
    });

    if (outcome.kind === 'ignored') return null;
    if (outcome.kind === 'reused') {
      return {
        evaluationRunId: outcome.run.id,
        agentJobId: outcome.run.agentJobId,
        status: outcome.run.status,
        reused: true,
      };
    }
    for (const agentJobId of outcome.agentJobIds) {
      await this.cancelAgentJob(agentJobId, 'superseded_by_github_update');
    }
    return this.queueForSubmission(
      outcome.submissionId,
      { mode: 'async', reason: input.reason },
      'github-webhook',
    );
  }

  private async queuePendingRepositoryEvaluation(
    submissionId: string,
    completedRunId: string,
  ) {
    const pending = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ProjectSubmission);
      const submission = await repository
        .createQueryBuilder('submission')
        .setLock('pessimistic_write')
        .where('submission.id = :submissionId', { submissionId })
        .getOne();
      if (
        !submission ||
        !['submitted', 'under_review'].includes(submission.status)
      ) {
        return null;
      }
      const metadata = { ...(submission.metadata ?? {}) };
      const value = metadata.githubEvaluationPendingTrigger;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
      }
      const trigger = value as Record<string, unknown>;
      if (trigger.evaluationRunId !== completedRunId) return null;
      const reason =
        typeof trigger.reason === 'string' ? trigger.reason : 'github_followup';
      delete metadata.githubEvaluationPendingTrigger;
      submission.metadata = metadata;
      await repository.save(submission);
      return { reason };
    });
    if (!pending) return null;
    return this.queueForSubmission(
      submissionId,
      { mode: 'async', reason: `${pending.reason}_followup` },
      'github-webhook',
    );
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
      taskId: submission.taskId,
      title: 'Submission evaluated',
      body: result.passed
        ? 'The AI evaluation of your submission passed. Principal reviewer decision is next.'
        : result.revisionNotes ||
          result.findings[0] ||
          'The AI evaluation requested changes. Check the submission feedback.',
    });
  }

  private async notifyPrincipalReviewer(
    submission: ProjectSubmission,
    result: EvaluateSubmissionResult,
  ) {
    const reviewer = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId: submission.projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(['accepted', 'in_progress']),
        },
        relations: ['freelancerProfile'],
      });
    if (!reviewer?.freelancerProfile?.userId) return;
    await this.notificationsService.createNotification({
      userId: reviewer.freelancerProfile.userId,
      projectId: submission.projectId,
      taskId: submission.taskId,
      type: 'reviewer_attention',
      title: 'Implementation evaluation ready',
      body: result.passed
        ? `AI passed ${submission.title ?? 'the submission'}; your acceptance decision is ready.`
        : `AI recommends revisions for ${submission.title ?? 'the submission'}; review its findings before deciding.`,
      actionUrl: `/reviewer/projects/${submission.projectId}`,
    });
  }

  private async notifyEvaluationFailure(
    projectId: string,
    taskId: string | null,
    error: string,
    trace?: string,
  ) {
    await this.incidents.record({
      subsystem: 'ai_jobs',
      operation: 'evaluate_implementation_submission',
      projectId,
      errorCode: 'evaluation_retries_exhausted',
      severity: 'critical',
      message: error,
      context: { taskId },
      trace,
    });
    const reviewer = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(['accepted', 'in_progress']),
        },
        relations: ['freelancerProfile'],
      });
    if (!reviewer?.freelancerProfile?.userId) return;
    await this.notificationsService.createNotification({
      userId: reviewer.freelancerProfile.userId,
      projectId,
      taskId,
      type: 'reviewer_attention',
      title: 'AI evaluation needs technical attention',
      body: 'Automated evaluation remains blocked after its retries. Operations has the failure trace; no approval can bypass the missing verdict.',
      actionUrl: `/reviewer/projects/${projectId}`,
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
      trigger: run.trigger,
      evaluatedCommitSha: run.evaluatedCommitSha,
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
      evidenceBundle: isAdmin ? run.evidenceBundle : undefined,
    };
  }

  private viewFindings(
    findings: Record<string, unknown> | null,
    isAdmin: boolean,
  ): Record<string, unknown> | null {
    if (!findings || isAdmin) return findings;
    const safe = { ...findings };
    delete safe.source;
    delete safe.auditBundle;
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
