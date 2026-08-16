import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PaymentReleaseRequestsService } from 'src/payments/payment-release-requests.service';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { ProjectSubmissionReview } from 'src/projects/entities/project-submission-review.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { ProjectTaskDependency } from 'src/projects/entities/project-task-dependency.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { EvaluationRun } from 'src/projects/entities/evaluation-run.entity';
import { GithubService } from 'src/repositories/github.service';
import { CreateRevisionRequestDto } from './dtos/create-revision-request.dto';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { ListRevisionRequestsDto } from './dtos/list-revision-requests.dto';
import { ListSubmissionsDto } from './dtos/list-submissions.dto';
import {
  ReviewSubmissionDto,
  type SubmissionCriterionReviewDto,
} from './dtos/review-submission.dto';
import { SubmitSubmissionDto } from './dtos/submit-submission.dto';
import { UpdateRevisionStatusDto } from './dtos/update-revision-status.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';
import {
  SUBMISSION_EVALUATION_DISPATCHER,
  type SubmissionEvaluationDispatcher,
} from './submission-evaluation-dispatcher';

type SubmissionWriteResult = {
  submission: ProjectSubmission;
  project: Project;
  previousSubmissionId: string | null;
  alreadySubmitted?: boolean;
};

export function assertTaskAcceptsDraft(task: Pick<ProjectTask, 'status'>) {
  if (['done', 'cancelled', 'review'].includes(task.status)) {
    throw new ConflictException(
      `A submission cannot be edited while its task is ${task.status}`,
    );
  }
}

export function assertSubmissionMatchesCurrentTask(
  submission: Pick<ProjectSubmission, 'taskId' | 'freelancerProfileId'> & {
    task: Pick<ProjectTask, 'assignedFreelancerProfileId'> | null;
  },
) {
  if (!submission.taskId || !submission.task) {
    throw new ConflictException(
      'The submission is no longer linked to an active project task',
    );
  }
  if (
    !submission.freelancerProfileId ||
    submission.task.assignedFreelancerProfileId !==
      submission.freelancerProfileId
  ) {
    throw new ConflictException(
      'The task assignment changed after this submission was created',
    );
  }
}

export function assertSubmissionApprovalEvaluation(
  submission: Pick<ProjectSubmission, 'submissionType' | 'commitSha'>,
  evaluation: Pick<
    EvaluationRun,
    'id' | 'status' | 'recommendation' | 'evaluatedCommitSha'
  > | null,
  input: Pick<ReviewSubmissionDto, 'manualReviewAcknowledged' | 'feedback'>,
) {
  if (!evaluation || evaluation.status !== 'completed') {
    throw new ConflictException(
      'Approval is blocked until the latest evaluation completes',
    );
  }
  if (
    ['pull_request', 'repository'].includes(submission.submissionType) &&
    (!submission.commitSha ||
      !evaluation.evaluatedCommitSha ||
      submission.commitSha.toLowerCase() !==
        evaluation.evaluatedCommitSha.toLowerCase())
  ) {
    throw new ConflictException(
      'Approval is blocked because the evaluation does not match the current submitted commit',
    );
  }
  if (evaluation.recommendation === 'changes_requested') {
    throw new ConflictException(
      'Approval is blocked because the latest evaluation requested changes',
    );
  }
  if (evaluation.recommendation === 'manual_review') {
    if (
      input.manualReviewAcknowledged !== true ||
      !input.feedback ||
      input.feedback.trim().length < 20
    ) {
      throw new ConflictException(
        'Manual-review evaluations require acknowledgement and at least 20 characters of review evidence',
      );
    }
    return;
  }
  if (evaluation.recommendation !== 'approve') {
    throw new ConflictException(
      'Approval is blocked because the evaluation has no approving verdict',
    );
  }
}

export interface SubmissionReviewCriterion {
  criterionKey: string;
  criterion: string;
}

export function resolveSubmissionReviewCriteria(
  evaluation: Pick<EvaluationRun, 'acceptanceCoverage'> | null,
): SubmissionReviewCriterion[] {
  const coverage = evaluation?.acceptanceCoverage;
  if (!coverage || typeof coverage !== 'object') return [];
  const completedItems = Array.isArray(coverage.items)
    ? (coverage.items as unknown[])
    : [];
  const rubricSnapshot = coverage.rubricSnapshot;
  const snapshotCriteria =
    rubricSnapshot &&
    typeof rubricSnapshot === 'object' &&
    Array.isArray((rubricSnapshot as Record<string, unknown>).criteria)
      ? ((rubricSnapshot as Record<string, unknown>).criteria as unknown[])
      : [];
  const source = completedItems.length ? completedItems : snapshotCriteria;
  const seen = new Set<string>();

  return source.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (completedItems.length && item.status === 'not_applicable') return [];
    const criterion =
      typeof item.criterion === 'string' ? item.criterion.trim() : '';
    if (!criterion) return [];
    const criterionKey =
      typeof item.key === 'string' && item.key.trim()
        ? item.key.trim()
        : `criterion_${index + 1}`;
    if (seen.has(criterionKey)) return [];
    seen.add(criterionKey);
    return [{ criterionKey, criterion }];
  });
}

export function validateSubmissionCriterionReviews(
  evaluation: Pick<EvaluationRun, 'acceptanceCoverage'> | null,
  input: SubmissionCriterionReviewDto[] | undefined,
) {
  const expected = resolveSubmissionReviewCriteria(evaluation);
  if (!expected.length) {
    if (input?.length) {
      throw new BadRequestException(
        'Criterion ratings do not match the evaluation rubric',
      );
    }
    return { reviews: [], score: null };
  }
  if (!input || input.length !== expected.length) {
    throw new BadRequestException(
      `Rate every applicable review criterion from 1 to 5 (${expected.length} required)`,
    );
  }

  const byKey = new Map(input.map((review) => [review.criterionKey, review]));
  const reviews = expected.map((criterion) => {
    const review = byKey.get(criterion.criterionKey);
    if (
      !review ||
      !Number.isInteger(review.rating) ||
      review.rating < 1 ||
      review.rating > 5
    ) {
      throw new BadRequestException(
        `Invalid or missing rating for criterion: ${criterion.criterion}`,
      );
    }
    return {
      ...criterion,
      rating: review.rating,
      comment: review.comment?.trim() || null,
    };
  });
  const score =
    (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) *
    20;
  return { reviews, score };
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProjectSubmission)
    private readonly submissionsRepository: Repository<ProjectSubmission>,
    @InjectRepository(ProjectRevisionRequest)
    private readonly revisionsRepository: Repository<ProjectRevisionRequest>,
    @InjectRepository(Project)
    private readonly projectsRepository: Repository<Project>,
    @InjectRepository(ProjectTask)
    private readonly tasksRepository: Repository<ProjectTask>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfilesRepository: Repository<FreelancerProfile>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly paymentReleaseRequestsService: PaymentReleaseRequestsService,
    private readonly githubService: GithubService,
    @Optional()
    @Inject(SUBMISSION_EVALUATION_DISPATCHER)
    private readonly evaluationDispatcher?: SubmissionEvaluationDispatcher,
  ) {}

  async createSubmission(
    projectId: string,
    dto: CreateSubmissionDto,
    requester: JwtPayload,
  ) {
    const result = await this.dataSource.transaction((manager) =>
      this.createSubmissionInTransaction(manager, projectId, dto, requester),
    );

    const dispatch =
      result.submission.status === 'submitted'
        ? await this.dispatchEvaluation(result.submission, requester.sub)
        : null;

    if (result.submission.status === 'submitted') {
      await this.notifySubmissionSubmitted(result.project, result.submission);
    }

    return {
      ...result.submission,
      evaluationDispatch: dispatch,
    };
  }

  async listProjectSubmissions(
    projectId: string,
    query: ListSubmissionsDto,
    requester: JwtPayload,
  ) {
    const project = await this.getProjectOrThrow(projectId);
    const profile = await this.assertProjectReadAccess(project, requester);
    return this.listSubmissions(projectId, query, requester, profile?.id);
  }

  async listFreelancerSubmissions(
    query: ListSubmissionsDto,
    requester: JwtPayload,
  ) {
    const profile = await this.getFreelancerProfileOrThrow(requester.sub);
    return this.listSubmissions(undefined, query, requester, profile.id, true);
  }

  async listAdminSubmissions(query: ListSubmissionsDto) {
    return this.listSubmissions(undefined, query, undefined, undefined, true);
  }

  async getSubmission(submissionId: string, requester: JwtPayload) {
    const submission = await this.submissionsRepository.findOne({
      where: { id: submissionId },
      relations: {
        project: true,
        task: true,
        milestone: true,
        repository: true,
        freelancerProfile: { user: true },
        reviews: { reviewer: true },
        evaluationRuns: true,
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    await this.assertSubmissionReadAccess(submission, requester);

    const openRevisionRequests = await this.revisionsRepository.find({
      where: {
        submissionId,
        status: In(['open', 'in_progress']),
      },
      order: { createdAt: 'DESC' },
    });
    const evaluationRuns = [...(submission.evaluationRuns ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    return {
      submission: {
        ...submission,
        evaluationRuns: undefined,
        reviews: undefined,
      },
      task: submission.task,
      milestone: submission.milestone,
      repository: submission.repository,
      latestEvaluationRun: evaluationRuns[0]
        ? this.toSubmissionEvaluationView(evaluationRuns[0], requester)
        : null,
      reviews: [...(submission.reviews ?? [])].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
      openRevisionRequests,
    };
  }

  async updateSubmission(
    submissionId: string,
    dto: UpdateSubmissionDto,
    requester: JwtPayload,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProjectSubmission);
      const submission = await repo
        .createQueryBuilder('submission')
        .setLock('pessimistic_write', undefined, ['submission'])
        .leftJoinAndSelect('submission.project', 'project')
        .leftJoinAndSelect('submission.task', 'task')
        .where('submission.id = :submissionId', { submissionId })
        .getOne();
      if (!submission) throw new NotFoundException('Submission not found');

      await this.assertSubmissionOwner(submission, requester, manager);
      if (!submission.taskId) {
        throw new ConflictException('The submission is not linked to a task');
      }
      const lockedTask = await manager
        .getRepository(ProjectTask)
        .createQueryBuilder('task')
        .setLock('pessimistic_write')
        .where('task.id = :taskId', { taskId: submission.taskId })
        .getOne();
      if (!lockedTask) throw new NotFoundException('Project task not found');
      submission.task = lockedTask;
      assertSubmissionMatchesCurrentTask(submission);
      assertTaskAcceptsDraft(submission.task);
      if (!['draft', 'changes_requested'].includes(submission.status)) {
        throw new ConflictException(
          'Only draft or changes-requested submissions can be edited',
        );
      }
      await this.validateRelatedSubmissionIds(
        manager,
        submission.projectId,
        submission.taskId,
        dto.milestoneId,
        dto.repositoryId,
      );

      if (submission.status === 'changes_requested') {
        await this.lockSubmissionVersionKey(
          manager,
          submission.taskId,
          submission.freelancerProfileId,
        );
        const draft = repo.create({
          ...this.editableSubmissionFields(submission),
          ...this.updateSubmissionFields(dto),
          id: undefined,
          status: 'draft',
          version: submission.version + 1,
          submittedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          approvedAt: null,
          rejectedAt: null,
          metadata: {
            ...(submission.metadata ?? {}),
            ...(dto.metadata ?? {}),
            replacesSubmissionId: submission.id,
          },
        });
        return repo.save(draft);
      }

      Object.assign(submission, this.updateSubmissionFields(dto));
      if (dto.metadata !== undefined) {
        submission.metadata = {
          ...(submission.metadata ?? {}),
          ...dto.metadata,
        };
      }
      return repo.save(submission);
    });
  }

  async submitSubmission(
    submissionId: string,
    dto: SubmitSubmissionDto,
    requester: JwtPayload,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProjectSubmission);
      let submission = await repo
        .createQueryBuilder('submission')
        .setLock('pessimistic_write', undefined, ['submission'])
        .leftJoinAndSelect('submission.project', 'project')
        .leftJoinAndSelect('submission.task', 'task')
        .where('submission.id = :submissionId', { submissionId })
        .getOne();
      if (!submission) throw new NotFoundException('Submission not found');

      await this.assertSubmissionOwner(submission, requester, manager);
      if (!submission.taskId) {
        throw new ConflictException('The submission is not linked to a task');
      }
      const lockedTask = await manager
        .getRepository(ProjectTask)
        .createQueryBuilder('task')
        .setLock('pessimistic_write')
        .where('task.id = :taskId', { taskId: submission.taskId })
        .getOne();
      if (!lockedTask) throw new NotFoundException('Project task not found');
      submission.task = lockedTask;
      assertSubmissionMatchesCurrentTask(submission);
      if (['submitted', 'under_review'].includes(submission.status)) {
        return {
          submission,
          project: submission.project,
          previousSubmissionId: null,
          alreadySubmitted: true,
        } satisfies SubmissionWriteResult;
      }
      if (!['draft', 'changes_requested'].includes(submission.status)) {
        throw new ConflictException('This submission cannot be submitted');
      }
      await this.assertTaskReadyForSubmission(
        manager,
        submission.task,
        submission.freelancerProfileId,
      );

      let previousSubmissionId: string | null = null;
      if (submission.status === 'changes_requested') {
        previousSubmissionId = submission.id;
        await this.lockSubmissionVersionKey(
          manager,
          submission.taskId,
          submission.freelancerProfileId,
        );
        const nextVersion = repo.create({
          ...this.editableSubmissionFields(submission),
          id: undefined,
          version: submission.version + 1,
          status: 'draft',
          submittedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          approvedAt: null,
          rejectedAt: null,
          metadata: {
            ...(submission.metadata ?? {}),
            replacesSubmissionId: submission.id,
          },
        });
        submission.status = 'superseded';
        await repo.save(submission);
        submission = await repo.save(nextVersion);
      }

      if (dto.summary !== undefined) submission.summary = dto.summary;
      await this.ensureImplementationRepository(manager, submission);
      this.assertSubmissionHasEvidence(submission);
      await this.markSubmissionSubmitted(manager, submission);
      submission = await repo.save(submission);

      return {
        submission,
        project: submission.project,
        previousSubmissionId,
      } satisfies SubmissionWriteResult;
    });

    if (result.alreadySubmitted) {
      return {
        ...result.submission,
        evaluationDispatch:
          result.submission.metadata?.evaluationDispatch ?? null,
        reused: true,
      };
    }

    const dispatch = await this.dispatchEvaluation(
      result.submission,
      requester.sub,
    );
    await this.notifySubmissionSubmitted(result.project, result.submission);
    return { ...result.submission, evaluationDispatch: dispatch };
  }

  async reviewSubmission(
    submissionId: string,
    dto: ReviewSubmissionDto,
    requester: JwtPayload,
  ) {
    if (dto.decision !== 'approved' && !dto.feedback?.trim()) {
      throw new BadRequestException(
        'General comments are required when requesting changes or rejecting a submission',
      );
    }
    const pullRequestAtReview =
      dto.decision === 'approved'
        ? await this.assertPullRequestHeadIsCurrent(submissionId, requester)
        : null;
    const result = await this.dataSource.transaction(async (manager) => {
      const submissionRepo = manager.getRepository(ProjectSubmission);
      const submission = await submissionRepo
        .createQueryBuilder('submission')
        .setLock('pessimistic_write', undefined, ['submission'])
        .leftJoinAndSelect('submission.project', 'project')
        .leftJoinAndSelect('submission.task', 'task')
        .leftJoinAndSelect('submission.milestone', 'milestone')
        .where('submission.id = :submissionId', { submissionId })
        .getOne();
      if (!submission) throw new NotFoundException('Submission not found');
      this.assertReviewerAccess(submission.project, requester);
      assertSubmissionMatchesCurrentTask(submission);
      if (!['submitted', 'under_review'].includes(submission.status)) {
        throw new ConflictException(
          'Only submitted or under-review work can be reviewed',
        );
      }

      const latestEvaluation = await manager
        .getRepository(EvaluationRun)
        .createQueryBuilder('evaluation')
        .where('evaluation.submissionId = :submissionId', {
          submissionId: submission.id,
        })
        .orderBy('evaluation.createdAt', 'DESC')
        .getOne();
      if (dto.decision === 'approved') {
        assertSubmissionApprovalEvaluation(submission, latestEvaluation, dto);
        if (
          pullRequestAtReview &&
          latestEvaluation?.evidenceBundle?.baseCommitSha !==
            pullRequestAtReview.baseSha
        ) {
          throw new ConflictException(
            'Approval is blocked because the pull-request base changed after its latest evaluation',
          );
        }
      }

      const criterionReview = validateSubmissionCriterionReviews(
        latestEvaluation,
        dto.criteriaReviews,
      );

      const now = new Date();
      const review = await manager.getRepository(ProjectSubmissionReview).save({
        projectId: submission.projectId,
        submissionId: submission.id,
        milestoneId: submission.milestoneId,
        taskId: submission.taskId,
        reviewerUserId: requester.sub,
        reviewerRole: requester.role,
        decision: dto.decision,
        feedback: dto.feedback?.trim() || null,
        requestedChanges: dto.requestedChanges ?? null,
        score:
          criterionReview.score !== null
            ? criterionReview.score.toFixed(2)
            : dto.score !== undefined
              ? dto.score.toFixed(2)
              : null,
        metadata: {
          criteriaReviews: criterionReview.reviews,
          ratingScale: 5,
          overallComment: dto.feedback?.trim() || null,
          ...(latestEvaluation
            ? {
                evaluationRunId: latestEvaluation.id,
                evaluationStatus: latestEvaluation.status,
                evaluationRecommendation: latestEvaluation.recommendation,
                evaluatedCommitSha: latestEvaluation.evaluatedCommitSha,
                manualReviewAcknowledged: dto.manualReviewAcknowledged === true,
              }
            : {}),
        },
      });

      submission.status = dto.decision;
      submission.reviewedBy = requester.sub;
      submission.reviewedAt = now;
      submission.approvedAt = dto.decision === 'approved' ? now : null;
      submission.rejectedAt = dto.decision === 'rejected' ? now : null;
      await submissionRepo.save(submission);

      if (submission.taskId) {
        await manager.getRepository(ProjectTask).update(submission.taskId, {
          status: dto.decision === 'approved' ? 'done' : 'changes_requested',
        });
      }

      let revisionRequest: ProjectRevisionRequest | null = null;
      if (
        dto.decision === 'changes_requested' &&
        (dto.createRevisionRequest ?? true)
      ) {
        revisionRequest = await this.createRevisionInTransaction(
          manager,
          submission.project,
          {
            milestoneId: submission.milestoneId ?? undefined,
            taskId: submission.taskId ?? undefined,
            submissionId: submission.id,
            assignedToFreelancerProfileId:
              submission.freelancerProfileId ?? undefined,
            priority: 'high',
            title: `Revision requested: ${submission.title ?? submission.task?.title ?? 'submission'}`,
            description: dto.feedback,
            requestedChanges: dto.requestedChanges,
          },
          requester,
        );
      }

      if (dto.decision === 'approved') {
        await manager.getRepository(ProjectRevisionRequest).update(
          {
            submissionId: submission.id,
            status: In(['open', 'in_progress']),
          },
          { status: 'resolved', resolvedAt: now },
        );
        await this.updateMilestoneAfterApproval(manager, submission);
      }

      return { submission, review, revisionRequest };
    });

    let releaseRequest: unknown = null;
    let releaseError: string | null = null;
    if (dto.decision === 'approved') {
      try {
        releaseRequest =
          await this.paymentReleaseRequestsService.createForApprovedSubmission(
            result.submission,
            requester,
          );
      } catch (error) {
        releaseError =
          error instanceof Error
            ? error.message
            : 'Payment release request could not be created';
      }
    }

    await this.notifySubmissionReviewed(result.submission, result.review);
    return { ...result, releaseRequest, releaseError };
  }

  private async assertPullRequestHeadIsCurrent(
    submissionId: string,
    requester: JwtPayload,
  ) {
    const submission = await this.submissionsRepository.findOne({
      where: { id: submissionId },
      relations: { repository: true, project: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    this.assertReviewerAccess(submission.project, requester);
    if (submission.submissionType !== 'pull_request') return null;
    if (!submission.repository || !submission.pullRequestUrl) {
      throw new ConflictException(
        'Approval is blocked because the pull request is not linked to the project repository',
      );
    }
    let parts: string[] = [];
    try {
      parts = new URL(submission.pullRequestUrl).pathname
        .split('/')
        .filter(Boolean);
    } catch {
      throw new ConflictException(
        'Approval is blocked because the pull-request URL is invalid',
      );
    }
    const number = Number(parts[3]);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new ConflictException(
        'Approval is blocked because the pull-request URL is invalid',
      );
    }
    const pullRequest = await this.githubService.getPullRequest({
      owner: submission.repository.owner,
      repoName: submission.repository.repoName,
      number,
    });
    if (pullRequest.state !== 'open' || pullRequest.draft) {
      throw new ConflictException(
        'Approval is blocked until the pull request is open and marked ready for review',
      );
    }
    if (
      !submission.commitSha ||
      pullRequest.headSha !== submission.commitSha.toLowerCase()
    ) {
      throw new ConflictException(
        'Approval is blocked because the pull request advanced after its latest evaluation',
      );
    }
    return pullRequest;
  }

  async createRevisionRequest(
    projectId: string,
    dto: CreateRevisionRequestDto,
    requester: JwtPayload,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const project = await manager.getRepository(Project).findOne({
        where: { id: projectId },
      });
      if (!project) throw new NotFoundException('Project not found');
      this.assertReviewerAccess(project, requester);
      return this.createRevisionInTransaction(manager, project, dto, requester);
    });
    await this.notifyRevisionCreated(result);
    return result;
  }

  async listProjectRevisionRequests(
    projectId: string,
    query: ListRevisionRequestsDto,
    requester: JwtPayload,
  ) {
    const project = await this.getProjectOrThrow(projectId);
    const profile = await this.assertProjectReadAccess(project, requester);

    const qb = this.revisionsRepository
      .createQueryBuilder('revision')
      .leftJoinAndSelect('revision.task', 'task')
      .leftJoinAndSelect('revision.milestone', 'milestone')
      .leftJoinAndSelect('revision.submission', 'submission')
      .where('revision.projectId = :projectId', { projectId });
    if (requester.role === UserRole.FREELANCER) {
      qb.andWhere(
        'revision.assignedToFreelancerProfileId = :freelancerProfileId',
        { freelancerProfileId: profile?.id },
      );
    }
    if (query.status) qb.andWhere('revision.status = :status', query);
    if (query.taskId) qb.andWhere('revision.taskId = :taskId', query);
    if (query.milestoneId) {
      qb.andWhere('revision.milestoneId = :milestoneId', query);
    }
    if (query.assignedToFreelancerProfileId) {
      qb.andWhere(
        'revision.assignedToFreelancerProfileId = :assignedToFreelancerProfileId',
        query,
      );
    }

    const [data, total] = await qb
      .orderBy('revision.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { data, total, page: query.page, limit: query.limit };
  }

  async updateRevisionStatus(
    revisionRequestId: string,
    dto: UpdateRevisionStatusDto,
    requester: JwtPayload,
  ) {
    const revision = await this.revisionsRepository.findOne({
      where: { id: revisionRequestId },
      relations: { project: true, assignedToFreelancerProfile: true },
    });
    if (!revision) throw new NotFoundException('Revision request not found');

    if (requester.role !== UserRole.ADMIN) {
      const profile = await this.getFreelancerProfileOrThrow(requester.sub);
      if (revision.assignedToFreelancerProfileId !== profile.id) {
        throw new ForbiddenException(
          'You can only update revision requests assigned to you',
        );
      }
    }
    if (dto.status === 'resolved') {
      await this.assertRevisionHasResolutionSubmission(revision);
    }

    revision.status = dto.status;
    revision.resolvedAt = dto.status === 'resolved' ? new Date() : null;
    revision.metadata = {
      ...(revision.metadata ?? {}),
      statusNotes: dto.notes ?? null,
      statusUpdatedBy: requester.sub,
      statusUpdatedAt: new Date().toISOString(),
    };
    const saved = await this.revisionsRepository.save(revision);
    await this.notifyRevisionStatusChanged(saved);
    return saved;
  }

  private async createSubmissionInTransaction(
    manager: EntityManager,
    projectId: string,
    dto: CreateSubmissionDto,
    requester: JwtPayload,
  ): Promise<SubmissionWriteResult> {
    const project = await manager.getRepository(Project).findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const task = await manager
      .getRepository(ProjectTask)
      .createQueryBuilder('task')
      .setLock('pessimistic_write')
      .where('task.id = :taskId', { taskId: dto.taskId })
      .andWhere('task.projectId = :projectId', { projectId })
      .getOne();
    if (!task) throw new NotFoundException('Project task not found');
    if (!task.assignedFreelancerProfileId) {
      throw new ConflictException(
        'The task must be assigned before work can be submitted',
      );
    }
    await this.assertTaskSubmissionAccess(task, requester, manager);
    await this.validateRelatedSubmissionIds(
      manager,
      projectId,
      task.id,
      dto.milestoneId,
      dto.repositoryId,
    );
    await this.lockSubmissionVersionKey(
      manager,
      task.id,
      task.assignedFreelancerProfileId,
    );

    const repo = manager.getRepository(ProjectSubmission);
    const latest = await repo.findOne({
      where: {
        taskId: task.id,
        freelancerProfileId: task.assignedFreelancerProfileId,
      },
      order: { version: 'DESC' },
    });
    if (
      latest &&
      ['draft', 'submitted', 'under_review'].includes(latest.status)
    ) {
      throw new ConflictException(
        'An active submission version already exists for this task',
      );
    }

    const submission = repo.create({
      projectId,
      milestoneId: dto.milestoneId ?? task.milestoneId,
      taskId: task.id,
      assignmentId: task.assignmentId,
      freelancerProfileId: task.assignedFreelancerProfileId,
      repositoryId: dto.repositoryId ?? null,
      version: (latest?.version ?? 0) + 1,
      status: dto.status ?? 'draft',
      submissionType: dto.submissionType,
      title: dto.title ?? null,
      summary: dto.summary ?? null,
      content: dto.content ?? null,
      fileUrls: dto.fileUrls ?? null,
      repoUrl: dto.repoUrl ?? null,
      branchName: dto.branchName ?? null,
      pullRequestUrl: dto.pullRequestUrl ?? null,
      commitSha: dto.commitSha ?? null,
      metadata: {
        ...(dto.metadata ?? {}),
        ...(latest ? { replacesSubmissionId: latest.id } : {}),
      },
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      approvedAt: null,
      rejectedAt: null,
    });
    await this.ensureImplementationRepository(manager, submission);

    const shouldSubmit = submission.status === 'submitted';
    if (shouldSubmit) {
      this.assertSubmissionHasEvidence(submission);
      await this.assertTaskReadyForSubmission(
        manager,
        task,
        submission.freelancerProfileId,
      );
      submission.status = 'draft';
    } else {
      assertTaskAcceptsDraft(task);
    }
    let saved = await repo.save(submission);
    if (shouldSubmit) {
      await this.markSubmissionSubmitted(manager, saved, latest ?? null);
      saved = await repo.save(saved);
    }
    return {
      submission: saved,
      project,
      previousSubmissionId: latest?.id ?? null,
    };
  }

  private async markSubmissionSubmitted(
    manager: EntityManager,
    submission: ProjectSubmission,
    previous?: ProjectSubmission | null,
  ) {
    const now = new Date();
    submission.status = 'submitted';
    submission.submittedAt = now;
    if (
      previous &&
      ['changes_requested', 'rejected'].includes(previous.status)
    ) {
      previous.status = 'superseded';
      await manager.getRepository(ProjectSubmission).save(previous);
    }
    if (submission.taskId) {
      await manager
        .getRepository(ProjectTask)
        .update(submission.taskId, { status: 'review' });
      if (submission.freelancerProfileId) {
        const revisionRepo = manager.getRepository(ProjectRevisionRequest);
        const revisions = await revisionRepo.find({
          where: {
            taskId: submission.taskId,
            assignedToFreelancerProfileId: submission.freelancerProfileId,
            status: In(['open', 'in_progress']),
          },
        });
        for (const revision of revisions) {
          revision.status = 'resolved';
          revision.resolvedAt = now;
          revision.metadata = {
            ...(revision.metadata ?? {}),
            resolvedBySubmissionId: submission.id,
            resolvedAt: now.toISOString(),
          };
        }
        if (revisions.length) await revisionRepo.save(revisions);
      }
    }
    const replacesSubmissionId = submission.metadata?.replacesSubmissionId;
    if (typeof replacesSubmissionId === 'string') {
      const replaced = await manager.getRepository(ProjectSubmission).findOne({
        where: { id: replacesSubmissionId },
      });
      if (
        replaced &&
        ['changes_requested', 'rejected'].includes(replaced.status)
      ) {
        replaced.status = 'superseded';
        await manager.getRepository(ProjectSubmission).save(replaced);
      }
    }
    await manager
      .getRepository(Project)
      .update(submission.projectId, { status: ProjectStatus.UNDER_REVIEW });
  }

  private async dispatchEvaluation(
    submission: ProjectSubmission,
    requestedBy: string,
  ) {
    if (!submission.taskId) return null;
    const dispatchedAt = new Date().toISOString();
    if (!this.evaluationDispatcher) {
      const dispatch = {
        status: 'pending_integration',
        dispatchedAt,
        message: 'Evaluation dispatcher is not registered yet',
      };
      await this.mergeSubmissionMetadata(submission.id, {
        evaluationDispatch: dispatch,
      });
      return dispatch;
    }

    try {
      const result = await this.evaluationDispatcher.queueSubmissionEvaluation({
        submissionId: submission.id,
        projectId: submission.projectId,
        taskId: submission.taskId,
        requestedBy,
      });
      const dispatch = { status: 'queued', dispatchedAt, ...result };
      await this.submissionsRepository.update(submission.id, {
        status: 'under_review',
        metadata: {
          ...(submission.metadata ?? {}),
          evaluationDispatch: dispatch,
        },
      });
      submission.status = 'under_review';
      submission.metadata = {
        ...(submission.metadata ?? {}),
        evaluationDispatch: dispatch,
      };
      return dispatch;
    } catch (error) {
      const dispatch = {
        status: 'failed',
        dispatchedAt,
        retryable: true,
        message:
          error instanceof Error ? error.message : 'Evaluation queue failed',
      };
      await this.mergeSubmissionMetadata(submission.id, {
        evaluationDispatch: dispatch,
      });
      return dispatch;
    }
  }

  private async mergeSubmissionMetadata(
    submissionId: string,
    metadata: Record<string, unknown>,
  ) {
    const current = await this.submissionsRepository.findOne({
      where: { id: submissionId },
      select: { id: true, metadata: true },
    });
    if (!current) return;
    current.metadata = { ...(current.metadata ?? {}), ...metadata };
    await this.submissionsRepository.save(current);
  }

  private async createRevisionInTransaction(
    manager: EntityManager,
    project: Project,
    dto: CreateRevisionRequestDto,
    requester: JwtPayload,
  ) {
    let submission: ProjectSubmission | null = null;
    let task: ProjectTask | null = null;
    if (dto.submissionId) {
      submission = await manager.getRepository(ProjectSubmission).findOne({
        where: { id: dto.submissionId, projectId: project.id },
      });
      if (!submission) throw new NotFoundException('Submission not found');
    }
    const taskId = dto.taskId ?? submission?.taskId ?? null;
    if (taskId) {
      task = await manager.getRepository(ProjectTask).findOne({
        where: { id: taskId, projectId: project.id },
      });
      if (!task) throw new NotFoundException('Project task not found');
    }
    const milestoneId =
      dto.milestoneId ?? submission?.milestoneId ?? task?.milestoneId ?? null;
    if (milestoneId) {
      const milestone = await manager.getRepository(ProjectMilestone).findOne({
        where: { id: milestoneId, projectId: project.id },
      });
      if (!milestone)
        throw new NotFoundException('Project milestone not found');
    }
    if (!submission && !task && !milestoneId) {
      throw new BadRequestException(
        'A revision request must reference a submission, task, or milestone',
      );
    }

    const assigneeId =
      dto.assignedToFreelancerProfileId ??
      submission?.freelancerProfileId ??
      task?.assignedFreelancerProfileId ??
      null;
    if (task?.assignedFreelancerProfileId && assigneeId) {
      if (task.assignedFreelancerProfileId !== assigneeId) {
        throw new BadRequestException(
          'Revision assignee must match the task assignee',
        );
      }
    }
    if (assigneeId) {
      const assignee = await manager
        .getRepository(FreelancerProfile)
        .findOne({ where: { id: assigneeId } });
      if (!assignee)
        throw new NotFoundException('Freelancer profile not found');
    }

    if (task) {
      await manager
        .getRepository(ProjectTask)
        .update(task.id, { status: 'changes_requested' });
    }
    return manager.getRepository(ProjectRevisionRequest).save({
      projectId: project.id,
      milestoneId,
      taskId,
      submissionId: submission?.id ?? null,
      requestedBy: requester.sub,
      assignedToFreelancerProfileId: assigneeId,
      status: 'open',
      priority: dto.priority ?? 'medium',
      title: dto.title,
      description: dto.description ?? null,
      requestedChanges: dto.requestedChanges ?? null,
      metadata: dto.metadata ?? null,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      resolvedAt: null,
    });
  }

  private async listSubmissions(
    projectId: string | undefined,
    query: ListSubmissionsDto,
    requester?: JwtPayload,
    forcedFreelancerProfileId?: string,
    includeProject = false,
  ) {
    const qb = this.submissionsRepository
      .createQueryBuilder('submission')
      .leftJoinAndSelect('submission.task', 'task')
      .leftJoinAndSelect('submission.milestone', 'milestone');
    if (includeProject) qb.leftJoinAndSelect('submission.project', 'project');
    if (projectId) qb.where('submission.projectId = :projectId', { projectId });
    else qb.where('1 = 1');

    const freelancerProfileId =
      forcedFreelancerProfileId ?? query.freelancerProfileId;
    if (requester?.role === UserRole.FREELANCER && !freelancerProfileId) {
      throw new ForbiddenException('Freelancer profile is required');
    }
    if (freelancerProfileId) {
      qb.andWhere('submission.freelancerProfileId = :freelancerProfileId', {
        freelancerProfileId,
      });
    }
    if (query.taskId) qb.andWhere('submission.taskId = :taskId', query);
    if (query.milestoneId) {
      qb.andWhere('submission.milestoneId = :milestoneId', query);
    }
    if (query.status) qb.andWhere('submission.status = :status', query);

    const [data, total] = await qb
      .orderBy('submission.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { data, total, page: query.page, limit: query.limit };
  }

  private async validateRelatedSubmissionIds(
    manager: EntityManager,
    projectId: string,
    taskId: string | null,
    milestoneId?: string,
    repositoryId?: string,
  ) {
    if (milestoneId) {
      const milestone = await manager.getRepository(ProjectMilestone).findOne({
        where: { id: milestoneId, projectId },
      });
      if (!milestone)
        throw new NotFoundException('Project milestone not found');
      if (taskId) {
        const task = await manager.getRepository(ProjectTask).findOne({
          where: { id: taskId, projectId },
        });
        if (task?.milestoneId && task.milestoneId !== milestoneId) {
          throw new BadRequestException(
            'Submission milestone must match the task milestone',
          );
        }
      }
    }
    if (repositoryId) {
      const repository = await manager
        .getRepository(ProjectRepository)
        .findOne({
          where: { id: repositoryId, projectId },
        });
      if (!repository)
        throw new NotFoundException('Project repository not found');
    }
  }

  private async assertProjectReadAccess(
    project: Project,
    requester: JwtPayload,
  ): Promise<FreelancerProfile | null> {
    if (requester.role === UserRole.ADMIN) return null;
    if (requester.role === UserRole.CUSTOMER) {
      if (project.customerId !== requester.sub) {
        throw new ForbiddenException('You cannot access this project');
      }
      return null;
    }
    const profile = await this.getFreelancerProfileOrThrow(requester.sub);
    const assignedTask = await this.tasksRepository.exist({
      where: {
        projectId: project.id,
        assignedFreelancerProfileId: profile.id,
      },
    });
    if (!assignedTask) {
      throw new ForbiddenException('You are not assigned to this project');
    }
    return profile;
  }

  private async assertSubmissionReadAccess(
    submission: ProjectSubmission,
    requester: JwtPayload,
  ) {
    if (requester.role === UserRole.ADMIN) return;
    if (requester.role === UserRole.CUSTOMER) {
      if (submission.project.customerId !== requester.sub) {
        throw new ForbiddenException('You cannot access this submission');
      }
      return;
    }
    const profile = await this.getFreelancerProfileOrThrow(requester.sub);
    if (submission.freelancerProfileId !== profile.id) {
      throw new ForbiddenException('You cannot access this submission');
    }
  }

  private assertReviewerAccess(project: Project, requester: JwtPayload) {
    if (requester.role === UserRole.ADMIN) return;
    if (
      requester.role !== UserRole.CUSTOMER ||
      project.customerId !== requester.sub
    ) {
      throw new ForbiddenException('You cannot review work for this project');
    }
  }

  private async assertTaskSubmissionAccess(
    task: ProjectTask,
    requester: JwtPayload,
    manager: EntityManager,
  ) {
    if (requester.role === UserRole.ADMIN) return;
    if (requester.role !== UserRole.FREELANCER) {
      throw new ForbiddenException('Only assigned freelancers can submit work');
    }
    const profile = await manager.getRepository(FreelancerProfile).findOne({
      where: { userId: requester.sub },
    });
    if (!profile || task.assignedFreelancerProfileId !== profile.id) {
      throw new ForbiddenException('This task is not assigned to you');
    }
  }

  private async assertSubmissionOwner(
    submission: ProjectSubmission,
    requester: JwtPayload,
    manager: EntityManager,
  ) {
    if (requester.role === UserRole.ADMIN) return;
    if (requester.role !== UserRole.FREELANCER) {
      throw new ForbiddenException('Only the submission owner can edit work');
    }
    const profile = await manager.getRepository(FreelancerProfile).findOne({
      where: { userId: requester.sub },
    });
    if (!profile || submission.freelancerProfileId !== profile.id) {
      throw new ForbiddenException('You do not own this submission');
    }
  }

  private async assertTaskReadyForSubmission(
    manager: EntityManager,
    task: ProjectTask,
    freelancerProfileId: string | null,
  ) {
    if (
      !freelancerProfileId ||
      task.assignedFreelancerProfileId !== freelancerProfileId
    ) {
      throw new ConflictException(
        "Only the task's current assignee can submit this work",
      );
    }
    assertTaskAcceptsDraft(task);
    if (task.status === 'blocked') {
      throw new ConflictException(
        'Move the task out of blocked status before submitting work',
      );
    }

    const unfinishedDependencies = await manager
      .getRepository(ProjectTask)
      .createQueryBuilder('dependencyTask')
      .innerJoin(
        ProjectTaskDependency,
        'dependency',
        'dependency.depends_on_task_id = dependencyTask.id AND dependency.task_id = :taskId',
        { taskId: task.id },
      )
      .where('dependencyTask.status != :done', { done: 'done' })
      .andWhere("dependency.dependency_type IN ('blocks', 'after')")
      .getCount();
    if (unfinishedDependencies > 0) {
      throw new ConflictException(
        'This task has unfinished blocking dependencies',
      );
    }
  }

  private assertSubmissionHasEvidence(submission: ProjectSubmission) {
    const hasEvidence = Boolean(
      submission.summary ||
      submission.content ||
      submission.fileUrls ||
      submission.repoUrl ||
      submission.pullRequestUrl ||
      submission.commitSha,
    );
    if (!hasEvidence) {
      throw new BadRequestException(
        'A submitted version must include work evidence',
      );
    }
    if (
      submission.submissionType === 'pull_request' &&
      !submission.pullRequestUrl
    ) {
      throw new BadRequestException(
        'pullRequestUrl is required for pull-request submissions',
      );
    }
    if (submission.submissionType === 'repository' && !submission.commitSha) {
      throw new BadRequestException(
        'commitSha is required for repository submissions',
      );
    }
    if (
      ['pull_request', 'repository'].includes(submission.submissionType) &&
      (!submission.repositoryId || !submission.repoUrl)
    ) {
      throw new BadRequestException(
        'GitHub submissions must be linked to the project repository',
      );
    }
  }

  private async ensureImplementationRepository(
    manager: EntityManager,
    submission: ProjectSubmission,
  ) {
    if (!['pull_request', 'repository'].includes(submission.submissionType)) {
      return;
    }
    const repository = submission.repositoryId
      ? await manager.getRepository(ProjectRepository).findOne({
          where: {
            id: submission.repositoryId,
            projectId: submission.projectId,
            status: 'active',
          },
        })
      : await manager.getRepository(ProjectRepository).findOne({
          where: {
            projectId: submission.projectId,
            provider: 'github',
            status: 'active',
          },
        });
    if (!repository) {
      throw new ConflictException(
        'The project needs an active GitHub repository before code can be submitted',
      );
    }
    submission.repositoryId = repository.id;
    submission.repoUrl = repository.repoUrl;
    if (
      submission.submissionType === 'pull_request' &&
      submission.pullRequestUrl
    ) {
      let pullRequestMatches = false;
      let pullRequestNumber: string | null = null;
      try {
        const url = new URL(submission.pullRequestUrl ?? '');
        const parts = url.pathname.split('/').filter(Boolean);
        pullRequestMatches =
          url.protocol === 'https:' &&
          ['github.com', 'www.github.com'].includes(
            url.hostname.toLowerCase(),
          ) &&
          parts[0]?.toLowerCase() === repository.owner.toLowerCase() &&
          parts[1]?.replace(/\.git$/i, '').toLowerCase() ===
            repository.repoName.toLowerCase() &&
          parts[2] === 'pull' &&
          /^\d+$/.test(parts[3] ?? '');
        pullRequestNumber = pullRequestMatches ? (parts[3] ?? null) : null;
      } catch {
        pullRequestMatches = false;
      }
      if (!pullRequestMatches || !pullRequestNumber) {
        throw new BadRequestException(
          'The pull request must belong to the active project GitHub repository',
        );
      }
      submission.pullRequestUrl = `https://github.com/${repository.owner}/${repository.repoName}/pull/${pullRequestNumber}`;
    }
  }

  private async assertRevisionHasResolutionSubmission(
    revision: ProjectRevisionRequest,
  ) {
    if (!revision.taskId || !revision.assignedToFreelancerProfileId) {
      throw new ConflictException(
        'A new submitted version is required to resolve this revision',
      );
    }
    const source = revision.submissionId
      ? await this.submissionsRepository.findOne({
          where: { id: revision.submissionId },
        })
      : null;
    const qb = this.submissionsRepository
      .createQueryBuilder('submission')
      .where('submission.taskId = :taskId', { taskId: revision.taskId })
      .andWhere('submission.freelancerProfileId = :freelancerProfileId', {
        freelancerProfileId: revision.assignedToFreelancerProfileId,
      })
      .andWhere('submission.status IN (:...statuses)', {
        statuses: ['submitted', 'under_review', 'approved'],
      });
    if (source) qb.andWhere('submission.version > :version', source);
    if (!(await qb.getExists())) {
      throw new ConflictException(
        'Submit a new work version before resolving this revision',
      );
    }
  }

  private async updateMilestoneAfterApproval(
    manager: EntityManager,
    submission: ProjectSubmission,
  ) {
    if (!submission.milestoneId) return;
    const remainingTasks = await manager.getRepository(ProjectTask).count({
      where: {
        milestoneId: submission.milestoneId,
        status: In([
          'todo',
          'blocked',
          'in_progress',
          'review',
          'changes_requested',
        ]),
      },
    });
    if (remainingTasks === 0) {
      await manager
        .getRepository(ProjectMilestone)
        .update(submission.milestoneId, { status: 'approved' });
    }
  }

  private async lockSubmissionVersionKey(
    manager: EntityManager,
    taskId: string | null,
    freelancerProfileId: string | null,
  ) {
    if (!taskId || !freelancerProfileId) {
      throw new BadRequestException(
        'Task and freelancer are required for submission versioning',
      );
    }
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `submission:${taskId}:${freelancerProfileId}`,
    ]);
  }

  private editableSubmissionFields(submission: ProjectSubmission) {
    return {
      projectId: submission.projectId,
      milestoneId: submission.milestoneId,
      taskId: submission.taskId,
      assignmentId: submission.assignmentId,
      freelancerProfileId: submission.freelancerProfileId,
      repositoryId: submission.repositoryId,
      submissionType: submission.submissionType,
      title: submission.title,
      summary: submission.summary,
      content: submission.content,
      fileUrls: submission.fileUrls,
      repoUrl: submission.repoUrl,
      branchName: submission.branchName,
      pullRequestUrl: submission.pullRequestUrl,
      commitSha: submission.commitSha,
      metadata: submission.metadata,
    };
  }

  private updateSubmissionFields(dto: UpdateSubmissionDto) {
    return {
      ...(dto.milestoneId !== undefined
        ? { milestoneId: dto.milestoneId }
        : {}),
      ...(dto.repositoryId !== undefined
        ? { repositoryId: dto.repositoryId }
        : {}),
      ...(dto.submissionType !== undefined
        ? { submissionType: dto.submissionType }
        : {}),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
      ...(dto.fileUrls !== undefined ? { fileUrls: dto.fileUrls } : {}),
      ...(dto.repoUrl !== undefined ? { repoUrl: dto.repoUrl } : {}),
      ...(dto.branchName !== undefined ? { branchName: dto.branchName } : {}),
      ...(dto.pullRequestUrl !== undefined
        ? { pullRequestUrl: dto.pullRequestUrl }
        : {}),
      ...(dto.commitSha !== undefined ? { commitSha: dto.commitSha } : {}),
    };
  }

  private toSubmissionEvaluationView(
    run: EvaluationRun,
    requester: JwtPayload,
  ) {
    if (requester.role === UserRole.ADMIN) return run;
    const findings = run.findings ? { ...run.findings } : null;
    if (findings) {
      delete findings.source;
      delete findings.auditBundle;
    }
    return {
      id: run.id,
      projectId: run.projectId,
      submissionId: run.submissionId,
      taskId: run.taskId,
      milestoneId: run.milestoneId,
      status: run.status,
      score: run.score,
      recommendation: run.recommendation,
      summary: run.summary,
      findings,
      acceptanceCoverage: run.acceptanceCoverage,
      riskFlags: run.riskFlags,
      trigger: run.trigger,
      evaluatedCommitSha: run.evaluatedCommitSha,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  private async getProjectOrThrow(projectId: string) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async getFreelancerProfileOrThrow(userId: string) {
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    return profile;
  }

  private async notifySubmissionSubmitted(
    project: Project,
    submission: ProjectSubmission,
  ) {
    await this.notifyUsers(
      await this.projectCustomerAndAdminIds(project.customerId),
      'Work submitted for review',
      submission.title ?? 'A freelancer submitted a new work version.',
      project.id,
      submission.taskId,
    );
  }

  private async notifySubmissionReviewed(
    submission: ProjectSubmission,
    review: ProjectSubmissionReview,
  ) {
    if (!submission.freelancerProfileId) return;
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { id: submission.freelancerProfileId },
    });
    if (!profile) return;
    const criteriaReviews = Array.isArray(review.metadata?.criteriaReviews)
      ? (review.metadata.criteriaReviews as Array<Record<string, unknown>>)
      : [];
    const criterionComments = criteriaReviews
      .filter((item) => typeof item.comment === 'string' && item.comment.trim())
      .slice(0, 3)
      .map(
        (item) =>
          `${String(item.criterion)} (${String(item.rating)}/5): ${String(item.comment)}`,
      );
    const body = [
      review.feedback?.trim(),
      review.score ? `Overall reviewer score: ${review.score}/100.` : null,
      ...criterionComments,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    await this.notifyUsers(
      [profile.userId],
      `Submission ${review.decision.replace(/_/g, ' ')}`,
      body ||
        `${submission.title ?? 'Your submitted work'} was ${review.decision.replace(/_/g, ' ')}.`,
      submission.projectId,
      submission.taskId,
    );
  }

  private async notifyRevisionCreated(revision: ProjectRevisionRequest) {
    if (!revision.assignedToFreelancerProfileId) return;
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { id: revision.assignedToFreelancerProfileId },
    });
    if (!profile) return;
    await this.notifyUsers(
      [profile.userId],
      'Revision requested',
      revision.description?.trim() || revision.title,
      revision.projectId,
      revision.taskId,
    );
  }

  private async notifyRevisionStatusChanged(revision: ProjectRevisionRequest) {
    await this.notifyUsers(
      await this.projectCustomerAndAdminIds(revision.project.customerId),
      `Revision ${revision.status.replace('_', ' ')}`,
      revision.title,
      revision.projectId,
      revision.taskId,
    );
  }

  private async projectCustomerAndAdminIds(customerId: string) {
    const admins = await this.usersRepository.find({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    return [...new Set([customerId, ...admins.map((admin) => admin.id)])];
  }

  private async notifyUsers(
    userIds: string[],
    title: string,
    body: string,
    projectId: string,
    taskId: string | null,
  ) {
    try {
      await Promise.all(
        userIds.map((userId) =>
          this.notificationsService.createNotification({
            userId,
            title,
            body,
            projectId,
            taskId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Could not create delivery notification: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
