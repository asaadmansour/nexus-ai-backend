import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import type { EvaluateSubmissionDto } from 'src/agents/dto/EvaluateSubmissionDto';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { ImplementationEvaluationSandboxService } from 'src/evaluations/implementation-evaluation-sandbox.service';
import { EvaluationsService } from 'src/evaluations/evaluations.service';
import { buildImplementationEvaluationRubric } from 'src/evaluations/submission-quality-criteria';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerPerformanceEvent } from 'src/freelancers/entities/freelancer-performance-event.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PaymentReleaseRequestsService } from 'src/payments/payment-release-requests.service';
import { Brief } from 'src/projects/entities/brief.entity';
import { ProjectHandoff } from 'src/projects/entities/project-handoff.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectRating } from 'src/projects/entities/project-rating.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectSpec } from 'src/projects/entities/project-spec.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectSubmissionReview } from 'src/projects/entities/project-submission-review.entity';
import { GithubService } from 'src/repositories/github.service';
import { ClientHandoffDecisionDto } from './dtos/client-handoff-decision.dto';
import { CreateProjectRatingDto } from './dtos/create-project-rating.dto';
import { ReviewProjectHandoffDto } from './dtos/review-project-handoff.dto';

const RETRYABLE_HANDOFF_STATUSES = [
  'integrating',
  'integration_failed',
  'verifying',
];
const CATEGORY_KEYS = ['quality', 'communication', 'timeliness'] as const;

type Contributor = {
  userId: string;
  freelancerProfileId: string;
  name: string;
  roleKeys: string[];
  rating: ProjectRating | null;
};

type ReviewerRatingContributor = Contributor & {
  recommendedRating: number | null;
  taskAverageScore: number | null;
  tasks: Array<{
    taskId: string;
    title: string;
    roleKey: string | null;
    reviewScore: number | null;
  }>;
};

@Injectable()
export class ProjectHandoffsService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ProjectHandoffsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly github: GithubService,
    private readonly sandbox: ImplementationEvaluationSandboxService,
    private readonly evaluations: EvaluationsService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentReleaseRequestsService,
    private readonly incidents: AutomationIncidentsService,
    @InjectRepository(ProjectHandoff)
    private readonly handoffs: Repository<ProjectHandoff>,
    @InjectRepository(ProjectRating)
    private readonly ratings: Repository<ProjectRating>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(ProjectTask)
    private readonly tasks: Repository<ProjectTask>,
    @InjectRepository(ProjectSubmission)
    private readonly submissions: Repository<ProjectSubmission>,
    @InjectRepository(ProjectRepository)
    private readonly repositories: Repository<ProjectRepository>,
  ) {}

  onModuleInit() {
    if (
      this.config.get<string>('FINAL_HANDOFF_AUTOMATION_ENABLED') === 'false'
    ) {
      return;
    }
    const initial = setTimeout(() => void this.reconcile(), 10_000);
    initial.unref();
    this.timer = setInterval(() => void this.reconcile(), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async afterSubmissionApproved(submissionId: string) {
    const submission = await this.submissions.findOne({
      where: { id: submissionId },
      relations: { project: true, repository: true, task: true },
    });
    if (!submission || submission.status !== 'approved') {
      throw new ConflictException('Only approved work can be integrated');
    }
    const integration = await this.integrateSubmission(submission);
    let handoff: ProjectHandoff | null = null;
    let handoffError: string | null = null;
    try {
      handoff = await this.prepareHandoff(submission.projectId);
    } catch (error) {
      handoffError = this.error(error);
      this.logger.error(
        `Could not prepare final handoff after integrating submission ${submission.id}: ${handoffError}`,
      );
      await this.notifyAdmins(
        submission.projectId,
        'Final handoff preparation failed',
        handoffError,
      );
    }
    if (handoff?.status === 'integrating') {
      setTimeout(() => void this.processHandoff(handoff.id), 0).unref();
    }
    return {
      integration,
      handoff: handoff ? this.publicHandoff(handoff) : null,
      handoffError,
    };
  }

  async getForProject(projectId: string, requester: JwtPayload) {
    const project = await this.getProject(projectId);
    await this.assertProjectAccess(project, requester);
    const handoff = await this.handoffs.findOne({
      where: { projectId },
      relations: { repository: true },
    });
    if (handoff) {
      handoff.project = project;
      await this.ensureDeliveryContract(handoff);
    }
    const contributors = await this.clientRatingContributors(
      projectId,
      requester.sub,
    );
    return {
      handoff: handoff ? this.publicHandoff(handoff) : null,
      contributors,
      clientCanDecide:
        requester.role === UserRole.CUSTOMER &&
        project.customerId === requester.sub &&
        handoff?.status === 'client_review',
      ratingsOpen: Boolean(
        handoff?.status === 'accepted' ||
        project.status === ProjectStatus.COMPLETED,
      ),
    };
  }

  async getForReviewer(projectId: string) {
    const handoff = await this.handoffs.findOne({
      where: { projectId },
      relations: { project: true, repository: true },
    });
    if (handoff) await this.ensureDeliveryContract(handoff);
    return handoff ? this.publicHandoff(handoff) : null;
  }

  async downloadVerifiedSource(projectId: string, requester: JwtPayload) {
    const project = await this.getProject(projectId);
    await this.assertProjectAccess(project, requester);
    const handoff = await this.handoffs.findOne({
      where: { projectId },
      relations: { project: true, repository: true },
    });
    if (
      !handoff ||
      !['client_review', 'accepted'].includes(handoff.status) ||
      !handoff.repository ||
      !handoff.integrationCommitSha
    ) {
      throw new ConflictException(
        'Verified source becomes available when the final delivery reaches client review',
      );
    }
    await this.ensureDeliveryContract(handoff);
    const requirements = this.deliveryEvidenceRequirements(handoff);
    if (!requirements.sourceArchive) {
      throw new ForbiddenException(
        'Source code was not included in this project delivery contract',
      );
    }
    const archive = await this.github.downloadRepositoryArchive({
      owner: handoff.repository.owner,
      repoName: handoff.repository.repoName,
      commitSha: handoff.integrationCommitSha,
    });
    const baseName = project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    return {
      ...archive,
      fileName: `${baseName || 'project'}-${handoff.integrationCommitSha.slice(0, 12)}.zip`,
      commitSha: handoff.integrationCommitSha,
    };
  }

  async getReviewerRatings(projectId: string, reviewerUserId: string) {
    await this.assertPrincipalReviewer(projectId, reviewerUserId);
    const project = await this.getProject(projectId);
    const handoff = await this.handoffs.findOne({ where: { projectId } });
    const contributors = await this.implementationContributors(
      projectId,
      reviewerUserId,
    );
    return {
      ratingsOpen:
        Boolean(
          handoff &&
          ['reviewer_review', 'client_review', 'accepted'].includes(
            handoff.status,
          ),
        ) || project.status === ProjectStatus.COMPLETED,
      contributors,
    };
  }

  async rateImplementationContributor(
    projectId: string,
    dto: CreateProjectRatingDto,
    reviewerUserId: string,
  ) {
    await this.assertPrincipalReviewer(projectId, reviewerUserId);
    const project = await this.getProject(projectId);
    const handoff = await this.handoffs.findOne({ where: { projectId } });
    if (
      (!handoff ||
        !['reviewer_review', 'client_review', 'accepted'].includes(
          handoff.status,
        )) &&
      project.status !== ProjectStatus.COMPLETED
    ) {
      throw new ConflictException(
        'Implementation ratings open after final integrated verification completes',
      );
    }
    const candidates = await this.implementationContributors(
      projectId,
      reviewerUserId,
    );
    const contributor = candidates.find(
      (item) => item.userId === dto.ratedUserId,
    );
    if (!contributor) {
      throw new BadRequestException(
        'The selected freelancer has no approved implementation task in this project',
      );
    }
    return this.saveContributorRating({
      project,
      contributor,
      dto,
      raterUserId: reviewerUserId,
      eventType: 'principal_rating_received',
      notificationTitle: 'Your principal reviewer submitted a project rating',
      notificationType: 'principal_rating_received',
    });
  }

  async review(
    projectId: string,
    dto: ReviewProjectHandoffDto,
    reviewerUserId: string,
  ) {
    const handoff = await this.handoffs.findOne({
      where: { projectId },
      relations: { project: true, repository: true },
    });
    if (!handoff) {
      throw new ConflictException(
        'The integrated project has not completed final verification yet',
      );
    }
    if (dto.decision === 'approved') {
      await this.ensureDeliveryContract(handoff);
      if (handoff.status !== 'reviewer_review') {
        throw new ConflictException(
          'Only a passing integrated build can be sent to the client',
        );
      }
      const recommendation = this.text(
        handoff.verificationReport?.recommendation,
      );
      if (!['approve', 'manual_review'].includes(recommendation)) {
        throw new ConflictException(
          'Final verification must approve the integrated build first',
        );
      }
      if (
        recommendation === 'manual_review' &&
        (dto.manualReviewAcknowledged !== true ||
          (dto.feedback?.trim().length ?? 0) < 20)
      ) {
        throw new ConflictException(
          'Manual review requires acknowledgement and at least 20 characters of evidence',
        );
      }
      const summary = dto.summary?.trim() || '';
      if (summary.length < 20) {
        throw new BadRequestException(
          'Add a client-facing delivery summary of at least 20 characters',
        );
      }
      const liveUrl = dto.liveUrl?.trim() || handoff.liveUrl;
      const artifactUrls = dto.artifactUrls ?? handoff.artifactUrls ?? [];
      const evidenceRequirements = this.deliveryEvidenceRequirements(handoff);
      if (evidenceRequirements.liveUrl && !liveUrl) {
        throw new BadRequestException(
          'This delivery contract requires a client-accessible live URL',
        );
      }
      if (evidenceRequirements.artifactUrls && artifactUrls.length === 0) {
        throw new BadRequestException(
          'This delivery contract requires at least one client-accessible artifact or documentation URL',
        );
      }
      const now = new Date();
      handoff.status = 'client_review';
      handoff.summary = summary;
      handoff.liveUrl = liveUrl || null;
      handoff.artifactUrls = artifactUrls;
      handoff.reviewedBy = reviewerUserId;
      handoff.reviewerFeedback = dto.feedback?.trim() || null;
      handoff.reviewerApprovedAt = now;
      handoff.clientReviewDueAt = new Date(
        now.getTime() + this.clientReviewHours() * 60 * 60 * 1000,
      );
      const metadata = { ...(handoff.metadata ?? {}) };
      delete metadata.clientReviewOverdueNotifiedAt;
      handoff.metadata = metadata;
      handoff.lastError = null;
      handoff.nextAttemptAt = null;
      const saved = await this.handoffs.save(handoff);
      await this.projects.update(projectId, {
        status: ProjectStatus.UNDER_REVIEW,
        automationStatus: 'awaiting_client_acceptance',
      });
      const project = await this.getProject(projectId);
      await this.notifications.createNotification({
        userId: project.customerId,
        projectId,
        title: 'Your project is ready for review',
        body: `The complete integrated build for ${project.title} passed verification and is ready for your acceptance.`,
        type: 'project_handoff_ready',
        actionUrl: `/projects/${projectId}/work`,
        metadata: {
          handoffId: saved.id,
          commitSha: saved.integrationCommitSha,
        },
      });
      return this.publicHandoff(saved);
    }

    const feedback = dto.feedback?.trim();
    if (
      ![
        'reviewer_review',
        'verification_failed',
        'client_changes_requested',
      ].includes(handoff.status)
    ) {
      throw new ConflictException(
        'Final changes can only be routed before client acceptance',
      );
    }
    if (!feedback || !dto.taskId) {
      throw new BadRequestException(
        'A task and actionable feedback are required when requesting changes',
      );
    }
    await this.routeRevision(handoff, dto.taskId, feedback, reviewerUserId);
    return this.publicHandoff(
      (await this.handoffs.findOneBy({ id: handoff.id }))!,
    );
  }

  async clientDecision(
    projectId: string,
    dto: ClientHandoffDecisionDto,
    customerUserId: string,
  ) {
    const project = await this.getProject(projectId);
    if (project.customerId !== customerUserId) {
      throw new ForbiddenException('You can only review your own project');
    }
    const handoff = await this.handoffs.findOne({ where: { projectId } });
    if (!handoff || handoff.status !== 'client_review') {
      throw new ConflictException('This project is not awaiting client review');
    }
    if (dto.decision === 'changes_requested') {
      const feedback = dto.feedback?.trim();
      if (!feedback) {
        throw new BadRequestException(
          'Explain what should change so the principal reviewer can route it',
        );
      }
      handoff.status = 'client_changes_requested';
      handoff.clientFeedback = feedback;
      handoff.clientReviewDueAt = null;
      await this.handoffs.save(handoff);
      await this.projects.update(projectId, {
        automationStatus: 'client_changes_requested',
      });
      const principalNotified = await this.notifyPrincipal(
        projectId,
        'Client requested final changes',
        feedback,
        'client_handoff_changes_requested',
      );
      if (!principalNotified) {
        await this.notifyAdmins(
          projectId,
          'Client changes have no active principal reviewer',
          feedback,
        );
      }
      return this.publicHandoff(handoff);
    }

    const acceptedAt = new Date();
    let completion: unknown;
    try {
      completion = await this.payments.completeProjectDelivery(
        projectId,
        customerUserId,
      );
    } catch (error) {
      await this.notifyAdmins(
        projectId,
        'Client acceptance could not finalize escrow',
        this.error(error),
      );
      throw error;
    }
    handoff.status = 'accepted';
    handoff.clientFeedback = dto.feedback?.trim() || null;
    handoff.clientAcceptedAt = acceptedAt;
    handoff.clientReviewDueAt = null;
    await this.handoffs.save(handoff);
    await this.notifyContributors(
      projectId,
      'Project accepted by the client',
      `${project.title} was accepted. Client ratings are now open.`,
      'project_accepted',
    );
    return { handoff: this.publicHandoff(handoff), completion };
  }

  async rateContributor(
    projectId: string,
    dto: CreateProjectRatingDto,
    customerUserId: string,
  ) {
    const project = await this.getProject(projectId);
    if (project.customerId !== customerUserId) {
      throw new ForbiddenException('You can only rate your own project team');
    }
    const handoff = await this.handoffs.findOne({ where: { projectId } });
    if (
      handoff?.status !== 'accepted' &&
      project.status !== ProjectStatus.COMPLETED
    ) {
      throw new ConflictException('Ratings open after final client acceptance');
    }
    const candidates = await this.clientRatingContributors(
      projectId,
      customerUserId,
    );
    const contributor = candidates.find(
      (item) => item.userId === dto.ratedUserId,
    );
    if (!contributor) {
      throw new BadRequestException(
        'The selected user is not this project principal reviewer',
      );
    }
    return this.saveContributorRating({
      project,
      contributor,
      dto,
      raterUserId: customerUserId,
      eventType: 'client_rating_received',
      notificationTitle: 'You received a client rating',
      notificationType: 'client_rating_received',
    });
  }

  async retry(projectId: string) {
    const current = await this.handoffs.findOne({ where: { projectId } });
    if (
      current &&
      !['integration_failed', 'verification_failed'].includes(current.status)
    ) {
      throw new ConflictException(
        'Only a failed integration or verification can be retried',
      );
    }
    const handoff = await this.prepareHandoff(projectId, true);
    if (!handoff) {
      throw new ConflictException(
        'All implementation tasks must be approved first',
      );
    }
    if (handoff.status === 'integration_failed') {
      throw new ConflictException(
        handoff.lastError ??
          'Approved pull requests must be integrated before final verification',
      );
    }
    handoff.status = 'integrating';
    handoff.nextAttemptAt = new Date();
    handoff.lastError = null;
    await this.handoffs.save(handoff);
    setTimeout(() => void this.processHandoff(handoff.id), 0).unref();
    return this.publicHandoff(handoff);
  }

  async reconcile() {
    await this.reconcileActivePullRequestUpdates();
    await this.reconcileSubmissionIntegrationFailures();
    await this.reconcileIntegratedSubmissionPayouts();
    const due = await this.handoffs.find({
      where: {
        status: In(RETRYABLE_HANDOFF_STATUSES),
        nextAttemptAt: LessThanOrEqual(new Date()),
      },
      order: { nextAttemptAt: 'ASC' },
      take: 10,
    });
    for (const handoff of due) {
      if (handoff.status === 'integration_failed') {
        const prepared = await this.prepareHandoff(handoff.projectId, true);
        if (prepared?.status === 'integrating') {
          await this.processHandoff(prepared.id);
        }
      } else {
        await this.processHandoff(handoff.id);
      }
    }
    await this.reconcileClientReviewDeadlines();
  }

  private async reconcileIntegratedSubmissionPayouts() {
    const submissions = await this.submissions
      .createQueryBuilder('submission')
      .where("submission.status = 'approved'")
      .andWhere('submission.reviewed_by IS NOT NULL')
      .andWhere(
        "submission.metadata -> 'integration' ->> 'status' IN ('merged', 'default_branch_verified', 'not_applicable')",
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM payment_release_requests request
          WHERE request.submission_id = submission.id
            AND request.status IN ('released', 'rejected')
        )`,
      )
      .orderBy('submission.updatedAt', 'ASC')
      .take(20)
      .getMany();
    for (const submission of submissions) {
      try {
        await this.payments.releaseApprovedSubmission(
          submission,
          submission.reviewedBy!,
        );
      } catch (error) {
        this.logger.warn(
          `Could not reconcile payout for integrated submission ${submission.id}: ${this.error(error)}`,
        );
      }
    }
  }

  private async reconcileActivePullRequestUpdates() {
    const active = await this.submissions
      .createQueryBuilder('submission')
      .leftJoinAndSelect('submission.repository', 'repository')
      .where("submission.status IN ('submitted', 'under_review')")
      .andWhere("submission.submission_type = 'pull_request'")
      .andWhere('submission.pull_request_url IS NOT NULL')
      .orderBy('submission.updatedAt', 'ASC')
      .take(20)
      .getMany();
    for (const submission of active) {
      if (
        !submission.repository ||
        !submission.pullRequestUrl ||
        !submission.commitSha
      ) {
        continue;
      }
      try {
        const number = this.pullRequestNumber(submission.pullRequestUrl);
        const pullRequest = await this.github.getPullRequest({
          owner: submission.repository.owner,
          repoName: submission.repository.repoName,
          number,
        });
        if (pullRequest.headSha !== submission.commitSha.toLowerCase()) {
          await this.evaluations.requeueForRepositoryUpdate({
            submissionId: submission.id,
            commitSha: pullRequest.headSha,
            reason: 'evaluation_reconciler_pull_request_update',
          });
          continue;
        }
        const priorSync = this.record(submission.metadata?.branchSync);
        if (
          this.text(priorSync.status) === 'conflict' &&
          this.text(priorSync.headSha) === pullRequest.headSha &&
          this.text(priorSync.baseSha) === pullRequest.baseSha
        ) {
          continue;
        }
        const sync = await this.github.syncPullRequestWithBase({
          owner: submission.repository.owner,
          repoName: submission.repository.repoName,
          number,
          expectedHeadSha: pullRequest.headSha,
          requiredBaseRef: submission.repository.defaultBranch,
        });
        if (sync.status === 'current') continue;
        const now = new Date().toISOString();
        submission.metadata = {
          ...(submission.metadata ?? {}),
          branchSync: {
            status: sync.status,
            message: sync.message,
            headSha: sync.headSha,
            baseSha: sync.baseSha,
            checkedAt: now,
          },
        };
        await this.submissions.save(submission);
        if (sync.status === 'conflict') {
          await Promise.all([
            this.notifySubmissionOwnerOfBranchConflict(
              submission,
              sync.message,
            ),
            this.notifyPrincipal(
              submission.projectId,
              'A pull request needs conflict resolution',
              (submission.title ?? 'Implementation work') +
                ' conflicts with ' +
                submission.repository.defaultBranch +
                '. The freelancer has been asked to update the feature branch.',
              'submission_branch_conflict',
            ),
          ]);
        }
      } catch (error) {
        this.logger.warn(
          'Could not inspect the active pull request for submission ' +
            submission.id +
            ': ' +
            this.error(error),
        );
      }
    }
  }

  private async reconcileSubmissionIntegrationFailures() {
    const failures = await this.submissions
      .createQueryBuilder('submission')
      .leftJoinAndSelect('submission.repository', 'repository')
      .where("submission.status = 'approved'")
      .andWhere("submission.metadata -> 'integration' ->> 'status' = 'failed'")
      .orderBy('submission.updatedAt', 'ASC')
      .take(20)
      .getMany();
    for (const submission of failures) {
      const integration = this.record(submission.metadata?.integration);
      try {
        if (await this.recoverApprovedIntegrationUpdate(submission)) continue;
      } catch (error) {
        this.logger.warn(
          'Could not inspect the integration recovery for submission ' +
            submission.id +
            ': ' +
            this.error(error),
        );
      }
      if (this.text(integration.freelancerNotifiedAt)) continue;
      try {
        await this.notifySubmissionOwnerOfIntegrationFailure(
          submission,
          this.text(integration.error) ||
            'GitHub could not merge the approved pull request',
        );
        submission.metadata = {
          ...(submission.metadata ?? {}),
          integration: {
            ...integration,
            freelancerNotifiedAt: new Date().toISOString(),
          },
        };
        await this.submissions.save(submission);
      } catch (error) {
        this.logger.warn(
          'Could not notify the owner of submission ' +
            submission.id +
            ': ' +
            this.error(error),
        );
      }
    }
  }

  private async recoverApprovedIntegrationUpdate(
    submission: ProjectSubmission,
  ) {
    if (
      !submission.repository ||
      !submission.pullRequestUrl ||
      !submission.commitSha
    ) {
      return false;
    }
    const number = this.pullRequestNumber(submission.pullRequestUrl);
    const pullRequest = await this.github.getPullRequest({
      owner: submission.repository.owner,
      repoName: submission.repository.repoName,
      number,
    });
    if (pullRequest.headSha === submission.commitSha.toLowerCase()) {
      return false;
    }
    const preservesApprovedCommit = await this.github.isCommitAncestor({
      owner: submission.repository.owner,
      repoName: submission.repository.repoName,
      ancestorSha: submission.commitSha,
      descendantSha: pullRequest.headSha,
    });
    if (!preservesApprovedCommit) return false;
    const recovered = await this.evaluations.requeueForRepositoryUpdate({
      submissionId: submission.id,
      commitSha: pullRequest.headSha,
      reason: 'integration_reconciler_pull_request_update',
      allowApprovedIntegrationRecovery: true,
    });
    return Boolean(recovered);
  }

  private async reconcileClientReviewDeadlines() {
    const overdue = await this.handoffs.find({
      where: {
        status: 'client_review',
        clientReviewDueAt: LessThanOrEqual(new Date()),
      },
      take: 20,
    });
    for (const handoff of overdue) {
      if (handoff.metadata?.clientReviewOverdueNotifiedAt) continue;
      const project = await this.getProject(handoff.projectId);
      const notifiedAt = new Date().toISOString();
      handoff.metadata = {
        ...(handoff.metadata ?? {}),
        clientReviewOverdueNotifiedAt: notifiedAt,
      };
      await this.handoffs.save(handoff);
      await Promise.all([
        this.notifications.createNotification({
          userId: project.customerId,
          projectId: project.id,
          title: 'Final delivery review is overdue',
          body: `Please accept ${project.title} or request specific final changes. The system will not auto-accept work without your decision.`,
          type: 'project_handoff_review_overdue',
          actionUrl: `/projects/${project.id}/work`,
          metadata: { handoffId: handoff.id, dueAt: handoff.clientReviewDueAt },
        }),
        this.notifyPrincipal(
          project.id,
          'Client final review is overdue',
          `The client has not decided on ${project.title}; follow up without changing the verified delivery state.`,
          'project_handoff_review_overdue',
        ),
      ]);
    }
  }

  private async integrateSubmission(submission: ProjectSubmission) {
    const prior = this.record(submission.metadata?.integration);
    if (
      ['merged', 'default_branch_verified', 'not_applicable'].includes(
        this.text(prior.status),
      )
    ) {
      await this.markSubmissionTaskIntegrated(submission);
      return prior;
    }
    const now = new Date().toISOString();
    try {
      let integration: Record<string, unknown>;
      if (submission.submissionType === 'pull_request') {
        if (
          !submission.repository ||
          !submission.pullRequestUrl ||
          !submission.commitSha
        ) {
          throw new ConflictException(
            'Approved pull request has incomplete repository metadata',
          );
        }
        const number = this.pullRequestNumber(submission.pullRequestUrl);
        const result = await this.github.mergePullRequest({
          owner: submission.repository.owner,
          repoName: submission.repository.repoName,
          number,
          expectedHeadSha: submission.commitSha,
          commitTitle: `Integrate ${submission.title ?? submission.task?.title ?? 'approved work'} (#${number})`,
        });
        if (!result.merged) {
          throw new ConflictException(
            result.message ?? 'Pull request could not be merged',
          );
        }
        integration = {
          status: 'merged',
          mergedAt: now,
          pullRequestNumber: number,
          sourceCommitSha: submission.commitSha,
          mergeCommitSha: result.sha,
          message: result.message,
        };
      } else if (['repository', 'repo'].includes(submission.submissionType)) {
        if (!submission.repository || !submission.commitSha) {
          throw new ConflictException(
            'Repository submission is missing its immutable commit',
          );
        }
        const head = await this.github.resolveCommit({
          owner: submission.repository.owner,
          repoName: submission.repository.repoName,
          ref: submission.repository.defaultBranch,
        });
        if (head.sha !== submission.commitSha.toLowerCase()) {
          throw new ConflictException(
            `Approved commit is not on ${submission.repository.defaultBranch}; integrate it before retrying`,
          );
        }
        integration = {
          status: 'default_branch_verified',
          verifiedAt: now,
          sourceCommitSha: submission.commitSha,
          mergeCommitSha: head.sha,
        };
      } else {
        integration = { status: 'not_applicable', verifiedAt: now };
      }
      submission.metadata = { ...(submission.metadata ?? {}), integration };
      await this.submissions.save(submission);
      await this.markSubmissionTaskIntegrated(submission);
      return integration;
    } catch (error) {
      const message = this.error(error);
      const integration: Record<string, unknown> = {
        status: 'failed',
        failedAt: now,
        retryable: true,
        error: message,
      };
      submission.metadata = { ...(submission.metadata ?? {}), integration };
      await this.submissions.save(submission);
      if (
        this.text(prior.status) !== 'failed' ||
        this.text(prior.error) !== message
      ) {
        await this.notifyPrincipal(
          submission.projectId,
          'Approved work needs integration attention',
          message,
          'submission_integration_failed',
        );
      }
      try {
        await this.notifySubmissionOwnerOfIntegrationFailure(
          submission,
          message,
        );
        integration.freelancerNotifiedAt = now;
        submission.metadata = { ...(submission.metadata ?? {}), integration };
        await this.submissions.save(submission);
      } catch (notificationError) {
        this.logger.warn(
          'Could not notify the owner of submission ' +
            submission.id +
            ': ' +
            this.error(notificationError),
        );
      }
      return integration;
    }
  }

  private async markSubmissionTaskIntegrated(submission: ProjectSubmission) {
    if (!submission.taskId) return;
    await this.tasks.update(submission.taskId, {
      status: 'done',
      assignmentStatus: 'completed',
    });
    if (!submission.milestoneId) return;
    const remainingTasks = await this.tasks.count({
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
      await this.dataSource
        .getRepository(ProjectMilestone)
        .update(submission.milestoneId, { status: 'approved' });
    }
  }

  private async prepareHandoff(projectId: string, force = false) {
    const project = await this.getProject(projectId);
    const tasks = await this.tasks.find({ where: { projectId } });
    const requiredTasks = tasks.filter((task) => task.status !== 'cancelled');
    if (
      !requiredTasks.length ||
      requiredTasks.some((task) => task.status !== 'done')
    ) {
      return null;
    }
    const approved = await this.submissions.find({
      where: { projectId, status: 'approved' },
      relations: { repository: true, task: true },
      order: { version: 'DESC' },
    });
    const latestByTask = new Map<string, ProjectSubmission>();
    for (const submission of approved) {
      if (submission.taskId && !latestByTask.has(submission.taskId)) {
        latestByTask.set(submission.taskId, submission);
      }
    }
    if (requiredTasks.some((task) => !latestByTask.has(task.id))) return null;
    for (const submission of latestByTask.values()) {
      await this.integrateSubmission(submission);
    }
    const refreshed = await this.submissions.findBy({
      id: In([...latestByTask.values()].map((item) => item.id)),
    });
    const failures = refreshed
      .map((item) => this.record(item.metadata?.integration))
      .filter((item) => this.text(item.status) === 'failed');
    const repository = await this.repositories.findOne({
      where: { projectId, status: 'active' },
    });
    if (!repository) return null;
    let handoff = await this.handoffs.findOne({ where: { projectId } });
    const creatingHandoff = !handoff;
    if (!handoff) {
      handoff = this.handoffs.create({
        projectId,
        repositoryId: repository.id,
        status: failures.length ? 'integration_failed' : 'integrating',
        integrationBranch: repository.defaultBranch,
        integrationCommitSha: null,
        summary: `Final integrated delivery for ${project.title}`,
        artifactUrls: [],
        attemptCount: 0,
        nextAttemptAt: new Date(),
        metadata: {},
      });
    }
    handoff.repositoryId = repository.id;
    handoff.integrationBranch = repository.defaultBranch;
    if (failures.length) {
      handoff.status = 'integration_failed';
      handoff.lastError = failures
        .map((item) => this.text(item.error))
        .join('; ');
      handoff.nextAttemptAt = new Date(Date.now() + 60_000);
    } else if (
      force ||
      [
        'integration_failed',
        'changes_requested',
        'client_changes_requested',
      ].includes(handoff.status)
    ) {
      handoff.status = 'integrating';
      handoff.lastError = null;
      handoff.nextAttemptAt = new Date();
    }
    await this.projects.update(projectId, {
      status: ProjectStatus.UNDER_REVIEW,
      automationStatus: failures.length
        ? 'integration_blocked'
        : 'integrating_delivery',
    });
    try {
      return await this.handoffs.save(handoff);
    } catch (error) {
      if (creatingHandoff && this.databaseErrorCode(error) === '23505') {
        const concurrent = await this.handoffs.findOne({
          where: { projectId },
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  private async processHandoff(handoffId: string) {
    const claimedUntil = new Date(Date.now() + 15 * 60_000);
    const claim = await this.handoffs
      .createQueryBuilder()
      .update(ProjectHandoff)
      .set({
        status: 'verifying',
        attemptCount: () => '"attempt_count" + 1',
        nextAttemptAt: claimedUntil,
      })
      .where('id = :handoffId', { handoffId })
      .andWhere('status IN (:...statuses)', {
        statuses: RETRYABLE_HANDOFF_STATUSES,
      })
      .andWhere(
        `(status <> 'verifying' OR next_attempt_at IS NULL OR next_attempt_at <= :now)`,
        { now: new Date() },
      )
      .execute();
    if (claim.affected !== 1) return;
    const handoff = await this.handoffs.findOne({
      where: { id: handoffId },
      relations: { project: true, repository: true },
    });
    if (!handoff) return;
    try {
      if (!handoff.repository)
        throw new Error('Project repository is unavailable');
      const head = await this.github.resolveCommit({
        owner: handoff.repository.owner,
        repoName: handoff.repository.repoName,
        ref: handoff.integrationBranch,
      });
      const taskRows = await this.tasks.find({
        where: { projectId: handoff.projectId },
      });
      const [brief, spec] = await Promise.all([
        this.dataSource.getRepository(Brief).findOne({
          where: { projectId: handoff.projectId },
        }),
        this.dataSource.getRepository(ProjectSpec).findOne({
          where: { projectId: handoff.projectId },
        }),
      ]);
      const dto = this.finalEvaluationDto(
        handoff,
        taskRows,
        head.sha,
        brief,
        spec,
      );
      const execution = await this.sandbox.evaluate(
        dto,
        `project-handoff:${handoff.id}:${handoff.attemptCount}`,
      );
      const recommendation = execution.result.passed
        ? execution.result.requiresHumanReview
          ? 'manual_review'
          : 'approve'
        : 'changes_requested';
      handoff.integrationCommitSha = execution.evaluatedCommitSha ?? head.sha;
      handoff.verificationReport = {
        ...execution.result,
        recommendation,
        evaluatedCommitSha: execution.evaluatedCommitSha ?? head.sha,
        completedAt: new Date().toISOString(),
      };
      handoff.auditBundle = execution.auditBundle;
      handoff.metadata = {
        ...(handoff.metadata ?? {}),
        deliveryContract: this.buildDeliveryContract(
          dto,
          handoff,
          execution.evaluatedCommitSha ?? head.sha,
          Array.isArray(execution.result.rubric) ? execution.result.rubric : [],
          taskRows,
        ),
      };
      handoff.lastError = null;
      handoff.nextAttemptAt = null;
      handoff.status = ['approve', 'manual_review'].includes(recommendation)
        ? 'reviewer_review'
        : 'verification_failed';
      await this.handoffs.save(handoff);
      await this.projects.update(handoff.projectId, {
        automationStatus:
          handoff.status === 'reviewer_review'
            ? 'awaiting_principal_handoff'
            : 'final_verification_failed',
      });
      const principalNotified = await this.notifyPrincipal(
        handoff.projectId,
        handoff.status === 'reviewer_review'
          ? 'Integrated delivery is ready for final review'
          : 'Integrated delivery failed final verification',
        execution.result.findings.join('\n') ||
          (handoff.status === 'reviewer_review'
            ? 'Review the verified commit and send it to the client.'
            : execution.result.revisionNotes ||
              'Review the final verification findings.'),
        handoff.status === 'reviewer_review'
          ? 'project_handoff_review_ready'
          : 'project_handoff_verification_failed',
      );
      if (!principalNotified) {
        await this.notifyAdmins(
          handoff.projectId,
          'Final delivery has no active principal reviewer',
          'Assign a principal reviewer so the verified delivery can be reviewed and sent to the client.',
        );
      }
    } catch (error) {
      handoff.status = 'integration_failed';
      handoff.lastError = this.error(error);
      handoff.nextAttemptAt = new Date(
        Date.now() +
          Math.min(30, Math.max(1, 2 ** handoff.attemptCount)) * 60_000,
      );
      await this.handoffs.save(handoff);
      this.logger.error(
        `Final handoff ${handoff.id} failed: ${handoff.lastError}`,
      );
      if (handoff.attemptCount === 1 || handoff.attemptCount % 5 === 0) {
        await this.notifyAdmins(
          handoff.projectId,
          'Final integration automation needs attention',
          handoff.lastError,
        );
      }
    }
  }

  private finalEvaluationDto(
    handoff: ProjectHandoff,
    tasks: ProjectTask[],
    commitSha: string,
    brief: Brief | null,
    spec: ProjectSpec | null,
  ): EvaluateSubmissionDto {
    const active = tasks.filter((task) => task.status !== 'cancelled');
    const values = (key: string) =>
      this.unique(
        active.flatMap((task) => this.strings(this.record(task.metadata)[key])),
      );
    const acceptanceCriteria = this.unique([
      ...active.flatMap((task) => this.strings(task.acceptanceCriteria)),
      ...this.strings(brief?.acceptanceCriteria),
    ]);
    const deliverables = this.unique([
      ...values('deliverables'),
      ...this.strings(brief?.deliverables),
      ...(brief?.deliverablesText ? [brief.deliverablesText] : []),
    ]);
    const integrationChecks = values('integrationChecks');
    const contractReferences = values('contractReferences');
    const ownedPaths = values('ownedPaths');
    const projectSpec = spec
      ? {
          architecture: spec.architecture,
          designSystem: spec.designSystem,
          apiContract: spec.apiContract,
          dataModel: spec.dataModel,
          conventions: spec.conventions,
          lockedAt: spec.lockedAt,
        }
      : null;
    const rubric = buildImplementationEvaluationRubric({
      submissionType: 'repo',
      task: {
        title: `Final integrated delivery: ${handoff.project.title}`,
        description:
          'Evaluate the complete integrated default-branch snapshot across every approved task and contract.',
        acceptanceCriteria,
        deliverables,
        integrationChecks,
        contractReferences,
        ownedPaths,
      },
      projectSpec,
    });
    return {
      project: { projectId: handoff.projectId, title: handoff.project.title },
      task: {
        taskId: handoff.id,
        title: `Final integrated delivery: ${handoff.project.title}`,
        description:
          'Verify cross-task integration, complete requirements, build/test results, security, and delivery readiness on the default branch.',
        isSpecTask: false,
        deliverables,
        acceptanceCriteria,
        integrationChecks,
        contractReferences,
        ownedPaths,
        evaluationCriteria: rubric.criteria,
        evaluationProfile: rubric.profile,
        qualityCriteria: rubric.criteria.map((item) => item.criterion),
      },
      submission: {
        submissionId: handoff.id,
        submissionType: 'repo',
        repositoryId: handoff.repositoryId,
        repositoryUrl: handoff.repository?.repoUrl ?? null,
        repositoryOwner: handoff.repository?.owner ?? null,
        repositoryName: handoff.repository?.repoName ?? null,
        commitSha,
        submissionText: handoff.summary,
        notes:
          'This is the project-level integration gate. Inspect the complete repository, run proportionate verification, and reject regressions or incomplete cross-task integration.',
      },
      brief: brief
        ? {
            summary: brief.summary,
            mainGoal: brief.mainGoal,
            targetUsers: brief.targetUsers,
            coreFeatures: brief.coreFeatures,
            platforms: brief.platforms,
            constraintsPreferences: brief.constraintsPreferences,
            nonFunctional: brief.nonFunctional,
            acceptanceCriteria: this.strings(brief.acceptanceCriteria),
            confirmedAt: brief.confirmedAt,
          }
        : null,
      projectSpec,
    };
  }

  private async ensureDeliveryContract(handoff: ProjectHandoff) {
    const existingContract = this.record(handoff.metadata?.deliveryContract);
    if (
      existingContract.verifiedAt &&
      existingContract.evidenceRequirements &&
      existingContract.responsibilityVersion === 1
    )
      return;
    if (!handoff.project || !handoff.repository) return;
    const [taskRows, brief, spec] = await Promise.all([
      this.tasks.find({ where: { projectId: handoff.projectId } }),
      this.dataSource.getRepository(Brief).findOne({
        where: { projectId: handoff.projectId },
      }),
      this.dataSource.getRepository(ProjectSpec).findOne({
        where: { projectId: handoff.projectId },
      }),
    ]);
    const commitSha =
      handoff.integrationCommitSha ||
      this.text(handoff.verificationReport?.evaluatedCommitSha);
    if (!commitSha) return;
    const dto = this.finalEvaluationDto(
      handoff,
      taskRows,
      commitSha,
      brief,
      spec,
    );
    const verificationReport = this.record(handoff.verificationReport);
    const rubric = Array.isArray(verificationReport.rubric)
      ? verificationReport.rubric.map((item: unknown) => this.record(item))
      : [];
    handoff.metadata = {
      ...(handoff.metadata ?? {}),
      deliveryContract: this.buildDeliveryContract(
        dto,
        handoff,
        commitSha,
        rubric,
        taskRows,
      ),
    };
    await this.handoffs.save(handoff);
  }

  private buildDeliveryContract(
    dto: EvaluateSubmissionDto,
    handoff: ProjectHandoff,
    commitSha: string,
    rubric: Array<Record<string, unknown>>,
    tasks: ProjectTask[],
  ) {
    const evidenceFor = (prefix: string, index: number) => {
      const item = rubric.find(
        (candidate) => candidate.key === `${prefix}_${index + 1}`,
      );
      return item
        ? {
            status: this.text(item.status) || 'manual_review',
            evidence: this.text(item.evidence) || null,
          }
        : { status: 'manual_review', evidence: null };
    };
    const activeTasks = tasks.filter((task) => task.status !== 'cancelled');
    const responsibilityFor = (deliverable: string) => {
      const normalized = deliverable.toLowerCase();
      const tokens = new Set(
        normalized.split(/[^a-z0-9]+/).filter((token) => token.length >= 3),
      );
      const scored = activeTasks.map((task) => {
        const searchable = [
          task.title,
          task.description,
          task.roleKey,
          ...this.strings(this.record(task.metadata).deliverables),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const score = [...tokens].filter((token) =>
          searchable.includes(token),
        ).length;
        return { task, score };
      });
      const bestScore = Math.max(0, ...scored.map((item) => item.score));
      let owners = scored
        .filter((item) => item.score === bestScore && bestScore > 0)
        .map((item) => item.task);
      if (
        owners.length === 0 &&
        /\b(source|code|repository|repo)\b/.test(normalized)
      ) {
        owners = activeTasks.filter((task) =>
          Boolean(task.assignedFreelancerProfileId),
        );
      }
      if (owners.length === 0) owners = activeTasks.slice(0, 1);
      return owners.map((task) => ({
        taskId: task.id,
        taskTitle: task.title,
        roleKey: task.roleKey,
      }));
    };
    const deliverables = (dto.task.deliverables ?? []).map((title, index) => ({
      title,
      ...evidenceFor('deliverable', index),
      responsibleTasks: responsibilityFor(title),
    }));
    const deliveryText = deliverables
      .map((item) => item.title)
      .join(' ')
      .toLowerCase();
    const evidenceRequirements = {
      liveUrl:
        /\b(live|deployed|deployment|hosted|hosting|production)\b/.test(
          deliveryText,
        ) || /\bworking (website|web app|application)\b/.test(deliveryText),
      artifactUrls:
        /\b(figma|prototype|wireframe|mockup|design file|documentation|docs|manual|report)\b/.test(
          deliveryText,
        ),
      sourceArchive: /\b(source|source code|codebase|repository|repo)\b/.test(
        deliveryText,
      ),
    };
    return {
      deliverables,
      acceptanceCriteria: (dto.task.acceptanceCriteria ?? []).map(
        (title, index) => ({ title, ...evidenceFor('acceptance', index) }),
      ),
      integrationChecks: (dto.task.integrationChecks ?? []).map(
        (title, index) => ({ title, ...evidenceFor('integration', index) }),
      ),
      repositoryUrl: handoff.repository?.repoUrl ?? null,
      branch: handoff.integrationBranch,
      evaluatedCommitSha: commitSha,
      evidenceRequirements,
      responsibilityVersion: 1,
      verifiedAt:
        this.text(handoff.verificationReport?.completedAt) ||
        new Date().toISOString(),
    };
  }

  private deliveryEvidenceRequirements(handoff: ProjectHandoff) {
    const contract = this.record(handoff.metadata?.deliveryContract);
    const stored = this.record(contract.evidenceRequirements);
    if (Object.keys(stored).length > 0) {
      return {
        liveUrl: stored.liveUrl === true,
        artifactUrls: stored.artifactUrls === true,
        sourceArchive: stored.sourceArchive === true,
      };
    }
    const deliverables = Array.isArray(contract.deliverables)
      ? contract.deliverables
          .map((item) => this.text(this.record(item).title))
          .join(' ')
          .toLowerCase()
      : '';
    return {
      liveUrl:
        /\b(live|deployed|deployment|hosted|hosting|production)\b/.test(
          deliverables,
        ) || /\bworking (website|web app|application)\b/.test(deliverables),
      artifactUrls:
        /\b(figma|prototype|wireframe|mockup|design file|documentation|docs|manual|report)\b/.test(
          deliverables,
        ),
      sourceArchive: /\b(source|source code|codebase|repository|repo)\b/.test(
        deliverables,
      ),
    };
  }

  private async routeRevision(
    handoff: ProjectHandoff,
    taskId: string,
    feedback: string,
    reviewerUserId: string,
  ) {
    const task = await this.tasks.findOne({
      where: { id: taskId, projectId: handoff.projectId },
    });
    if (!task?.assignedFreelancerProfileId) {
      throw new BadRequestException(
        'Choose an assigned implementation task for this revision',
      );
    }
    const submission = await this.submissions.findOne({
      where: { taskId, status: 'approved' },
      order: { version: 'DESC' },
    });
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(ProjectRevisionRequest, {
        where: { taskId, status: In(['open', 'in_progress']) },
      });
      if (!existing) {
        await manager.save(
          ProjectRevisionRequest,
          manager.create(ProjectRevisionRequest, {
            projectId: handoff.projectId,
            milestoneId: task.milestoneId,
            taskId,
            submissionId: submission?.id ?? null,
            requestedBy: reviewerUserId,
            assignedToFreelancerProfileId: task.assignedFreelancerProfileId,
            status: 'open',
            priority: 'high',
            title: `Final integration revision: ${task.title}`,
            description: feedback,
            requestedChanges: {
              source: 'project_handoff',
              handoffId: handoff.id,
              verificationReport: handoff.verificationReport,
            },
            metadata: {
              generatedBy: 'principal_reviewer',
              handoffId: handoff.id,
            },
            dueAt: task.dueAt,
            resolvedAt: null,
          }),
        );
      }
      await manager.update(ProjectTask, taskId, {
        status: 'changes_requested',
        assignmentStatus: 'changes_requested',
      });
      await manager.update(ProjectHandoff, handoff.id, {
        status: 'changes_requested',
        reviewerFeedback: feedback,
        reviewedBy: reviewerUserId,
        nextAttemptAt: null,
      });
      await manager.update(Project, handoff.projectId, {
        automationStatus: 'final_changes_requested',
      });
    });
    const profile = await this.dataSource
      .getRepository(FreelancerProfile)
      .findOne({
        where: { id: task.assignedFreelancerProfileId },
      });
    if (profile) {
      await this.notifications.createNotification({
        userId: profile.userId,
        projectId: handoff.projectId,
        taskId,
        title: 'Final integration revision requested',
        body: feedback,
        type: 'project_handoff_revision',
        actionUrl: `/freelancer/projects/${handoff.projectId}/tasks/${taskId}`,
        metadata: { handoffId: handoff.id },
      });
    }
  }

  private async clientRatingContributors(
    projectId: string,
    raterUserId: string,
  ) {
    const contributors = await this.contributors(projectId, raterUserId);
    return contributors.filter((contributor) =>
      contributor.roleKeys.includes('principal_reviewer'),
    );
  }

  private async implementationContributors(
    projectId: string,
    raterUserId: string,
  ): Promise<ReviewerRatingContributor[]> {
    const approved = await this.submissions.find({
      where: { projectId, status: 'approved' },
      relations: { freelancerProfile: { user: true }, task: true },
      order: { createdAt: 'ASC' },
    });
    const implementation = approved.filter(
      (submission) =>
        submission.taskId &&
        submission.task &&
        submission.freelancerProfile?.user,
    );
    if (!implementation.length) return [];
    const submissionIds = implementation.map((submission) => submission.id);
    const [reviews, existingRatings] = await Promise.all([
      this.dataSource.getRepository(ProjectSubmissionReview).find({
        where: {
          submissionId: In(submissionIds),
          decision: 'approved',
        },
        order: { createdAt: 'DESC' },
      }),
      this.ratings.find({ where: { projectId, raterUserId } }),
    ]);
    const reviewBySubmission = new Map<string, ProjectSubmissionReview>();
    for (const review of reviews) {
      if (!reviewBySubmission.has(review.submissionId)) {
        reviewBySubmission.set(review.submissionId, review);
      }
    }
    const ratingsByUser = new Map(
      existingRatings.map((rating) => [rating.ratedUserId, rating]),
    );
    const contributors = new Map<
      string,
      Omit<ReviewerRatingContributor, 'recommendedRating' | 'taskAverageScore'>
    >();
    for (const submission of implementation) {
      const profile = submission.freelancerProfile!;
      const user = profile.user;
      const savedReviewScore = reviewBySubmission.get(submission.id)?.score;
      const reviewScoreValue =
        savedReviewScore === null || savedReviewScore === undefined
          ? Number.NaN
          : Number(savedReviewScore);
      const reviewScore = Number.isFinite(reviewScoreValue)
        ? Math.max(
            0,
            Math.min(
              100,
              reviewScoreValue <= 5 ? reviewScoreValue * 20 : reviewScoreValue,
            ),
          )
        : null;
      const current = contributors.get(user.id) ?? {
        userId: user.id,
        freelancerProfileId: profile.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        roleKeys: [],
        rating: ratingsByUser.get(user.id) ?? null,
        tasks: [],
      };
      const roleKey = submission.task?.roleKey ?? 'implementation';
      if (!current.roleKeys.includes(roleKey)) current.roleKeys.push(roleKey);
      current.tasks.push({
        taskId: submission.taskId!,
        title: submission.task!.title,
        roleKey: submission.task!.roleKey,
        reviewScore,
      });
      contributors.set(user.id, current);
    }
    return [...contributors.values()]
      .map((contributor) => {
        const scores = contributor.tasks
          .map((task) => task.reviewScore)
          .filter((score): score is number => score !== null);
        const taskAverageScore = scores.length
          ? scores.reduce((total, score) => total + score, 0) / scores.length
          : null;
        return {
          ...contributor,
          roleKeys: contributor.roleKeys.sort(),
          taskAverageScore,
          recommendedRating:
            taskAverageScore === null
              ? null
              : Math.max(1, Math.min(5, Math.round(taskAverageScore / 20))),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async saveContributorRating(input: {
    project: Project;
    contributor: Contributor;
    dto: CreateProjectRatingDto;
    raterUserId: string;
    eventType: string;
    notificationTitle: string;
    notificationType: string;
  }) {
    const categories = input.dto.categoryRatings ?? null;
    if (categories) {
      for (const [key, value] of Object.entries(categories)) {
        if (
          !CATEGORY_KEYS.includes(key as (typeof CATEGORY_KEYS)[number]) ||
          !Number.isInteger(value) ||
          value < 1 ||
          value > 5
        ) {
          throw new BadRequestException(
            'Category ratings may contain quality, communication, and timeliness values from 1 to 5',
          );
        }
      }
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(ProjectRating, {
        where: {
          projectId: input.project.id,
          raterUserId: input.raterUserId,
          ratedUserId: input.dto.ratedUserId,
        },
      });
      if (existing) {
        return { rating: existing, created: false };
      }
      const saved = await manager.save(
        ProjectRating,
        manager.create(ProjectRating, {
          projectId: input.project.id,
          raterUserId: input.raterUserId,
          ratedUserId: input.dto.ratedUserId,
          freelancerProfileId: input.contributor.freelancerProfileId,
          roleKeys: input.contributor.roleKeys,
          rating: input.dto.rating,
          categoryRatings: categories,
          comment: input.dto.comment?.trim() || null,
        }),
      );
      const aggregate = await manager
        .getRepository(ProjectRating)
        .createQueryBuilder('rating')
        .select('AVG(rating.rating)', 'average')
        .addSelect('COUNT(*)', 'count')
        .where('rating.freelancerProfileId = :profileId', {
          profileId: input.contributor.freelancerProfileId,
        })
        .getRawOne<{ average: string; count: string }>();
      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: input.contributor.freelancerProfileId },
      });
      const scoreDelta = (input.dto.rating - 3) * 2;
      await manager.update(
        FreelancerProfile,
        input.contributor.freelancerProfileId,
        {
          avgRating: Number(aggregate?.average ?? input.dto.rating).toFixed(2),
          ratingsCount: Number(aggregate?.count ?? 1),
          performanceScore: Math.max(
            0,
            Math.min(
              100,
              Number(profile?.performanceScore ?? 100) + scoreDelta,
            ),
          ).toFixed(2),
        },
      );
      await manager.save(
        FreelancerPerformanceEvent,
        manager.create(FreelancerPerformanceEvent, {
          freelancerProfileId: input.contributor.freelancerProfileId,
          projectId: input.project.id,
          taskId: null,
          eventType: input.eventType,
          scoreDelta: scoreDelta.toFixed(2),
          moneyDelta: '0.00',
          currency: input.project.quotedCurrency ?? input.project.currency,
          reason:
            input.dto.comment?.trim() ||
            `Project rating: ${input.dto.rating}/5`,
          metadata: { ratingId: saved.id, categoryRatings: categories },
        }),
      );
      return { rating: saved, created: true };
    });
    if (!result.created) return result.rating;
    await this.notifications.createNotification({
      userId: input.contributor.userId,
      projectId: input.project.id,
      title: input.notificationTitle,
      body: `${input.project.title}: ${input.dto.rating}/5${input.dto.comment?.trim() ? ` — ${input.dto.comment.trim()}` : ''}`,
      type: input.notificationType,
      actionUrl: `/freelancer/projects/${input.project.id}`,
      metadata: { ratingId: result.rating.id, rating: input.dto.rating },
    });
    return result.rating;
  }

  private async assertPrincipalReviewer(
    projectId: string,
    reviewerUserId: string,
  ) {
    const assignment = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(['accepted', 'in_progress', 'completed']),
        },
        relations: { freelancerProfile: true },
      });
    if (assignment?.freelancerProfile?.userId !== reviewerUserId) {
      throw new ForbiddenException(
        'Only the assigned principal reviewer can rate implementation work',
      );
    }
  }

  private async contributors(
    projectId: string,
    raterUserId: string,
  ): Promise<Contributor[]> {
    const assignments = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .find({
        where: {
          projectId,
          status: In(['accepted', 'in_progress', 'completed']),
        },
        relations: { freelancerProfile: { user: true } },
      });
    const approved = await this.submissions.find({
      where: { projectId, status: 'approved' },
      relations: { freelancerProfile: { user: true }, task: true },
    });
    const existing = await this.ratings.find({
      where: { projectId, raterUserId },
    });
    const ratingsByUser = new Map(
      existing.map((rating) => [rating.ratedUserId, rating]),
    );
    const map = new Map<string, Omit<Contributor, 'rating'>>();
    const add = (
      profile: FreelancerProfile | null | undefined,
      roleKey: string | null,
    ) => {
      if (!profile?.user) return;
      const current = map.get(profile.userId) ?? {
        userId: profile.userId,
        freelancerProfileId: profile.id,
        name: `${profile.user.firstName} ${profile.user.lastName}`.trim(),
        roleKeys: [],
      };
      if (roleKey && !current.roleKeys.includes(roleKey))
        current.roleKeys.push(roleKey);
      map.set(profile.userId, current);
    };
    assignments.forEach((assignment) =>
      add(assignment.freelancerProfile, assignment.roleKey),
    );
    approved.forEach((submission) =>
      add(
        submission.freelancerProfile,
        submission.task?.roleKey ?? 'implementation',
      ),
    );
    return [...map.values()]
      .map((item) => ({
        ...item,
        roleKeys: item.roleKeys.sort(),
        rating: ratingsByUser.get(item.userId) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async notifyPrincipal(
    projectId: string,
    title: string,
    body: string,
    type: string,
  ) {
    const assignment = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(['accepted', 'in_progress']),
        },
        relations: { freelancerProfile: true },
      });
    if (!assignment?.freelancerProfile) return false;
    await this.notifications.createNotification({
      userId: assignment.freelancerProfile.userId,
      projectId,
      title,
      body,
      type,
      actionUrl: `/reviewer/projects/${projectId}`,
    });
    return true;
  }

  private async notifySubmissionOwnerOfIntegrationFailure(
    submission: ProjectSubmission,
    message: string,
  ) {
    if (!submission.freelancerProfileId) return;
    const profile = await this.dataSource
      .getRepository(FreelancerProfile)
      .findOneBy({ id: submission.freelancerProfileId });
    if (!profile) return;
    await this.notifications.createNotification({
      userId: profile.userId,
      projectId: submission.projectId,
      taskId: submission.taskId,
      title: 'Resolve your pull request conflicts',
      body: `${message}. Update your feature branch from main, resolve the conflicts, and push it. Nexus will evaluate the new commit automatically; your approval and payment stay recorded.`,
      type: 'submission_integration_failed',
      actionUrl: submission.taskId
        ? `/freelancer/projects/${submission.projectId}/tasks/${submission.taskId}`
        : `/freelancer/projects/${submission.projectId}`,
      metadata: {
        submissionId: submission.id,
        pullRequestUrl: submission.pullRequestUrl,
        branchName: submission.branchName,
      },
    });
  }

  private async notifySubmissionOwnerOfBranchConflict(
    submission: ProjectSubmission,
    message: string | null,
  ) {
    if (!submission.freelancerProfileId) return;
    const profile = await this.dataSource
      .getRepository(FreelancerProfile)
      .findOneBy({ id: submission.freelancerProfileId });
    if (!profile) return;
    await this.notifications.createNotification({
      userId: profile.userId,
      projectId: submission.projectId,
      taskId: submission.taskId,
      title: 'Update your feature branch from main',
      body:
        (message ?? 'Your pull request has merge conflicts') +
        '. Resolve the conflicts on your feature branch and push it. Nexus will reevaluate the new commit automatically.',
      type: 'submission_branch_conflict',
      actionUrl: submission.taskId
        ? '/freelancer/projects/' +
          submission.projectId +
          '/tasks/' +
          submission.taskId
        : '/freelancer/projects/' + submission.projectId,
      metadata: {
        submissionId: submission.id,
        pullRequestUrl: submission.pullRequestUrl,
        branchName: submission.branchName,
      },
    });
  }

  private async notifyContributors(
    projectId: string,
    title: string,
    body: string,
    type: string,
  ) {
    const recipients = await this.contributors(
      projectId,
      '00000000-0000-0000-0000-000000000000',
    );
    await Promise.all(
      recipients.map((recipient) =>
        this.notifications.createNotification({
          userId: recipient.userId,
          projectId,
          title,
          body,
          type,
          actionUrl: `/freelancer/projects/${projectId}`,
        }),
      ),
    );
  }

  private async notifyAdmins(projectId: string, title: string, body: string) {
    await this.incidents.record({
      subsystem: 'delivery',
      operation: 'final_handoff',
      projectId,
      errorCode: title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 80),
      severity: title.toLowerCase().includes('failed') ? 'critical' : 'error',
      message: body,
      context: { title },
    });
  }

  private async assertProjectAccess(project: Project, requester: JwtPayload) {
    if (
      requester.role === UserRole.ADMIN ||
      project.customerId === requester.sub
    )
      return;
    const profile = await this.dataSource
      .getRepository(FreelancerProfile)
      .findOne({
        where: { userId: requester.sub },
      });
    if (!profile)
      throw new ForbiddenException('You cannot access this project handoff');
    const [assignment, submission] = await Promise.all([
      this.dataSource.getRepository(ProjectRoleAssignment).exists({
        where: { projectId: project.id, freelancerProfileId: profile.id },
      }),
      this.submissions.exists({
        where: { projectId: project.id, freelancerProfileId: profile.id },
      }),
    ]);
    if (!assignment && !submission) {
      throw new ForbiddenException('You cannot access this project handoff');
    }
  }

  private async getProject(projectId: string) {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private publicHandoff(handoff: ProjectHandoff) {
    const audit = handoff.auditBundle ? { ...handoff.auditBundle } : null;
    if (audit) delete audit.sandboxLog;
    return {
      id: handoff.id,
      projectId: handoff.projectId,
      repositoryId: handoff.repositoryId,
      repositoryUrl: handoff.repository?.repoUrl ?? null,
      status: handoff.status,
      integrationBranch: handoff.integrationBranch,
      integrationCommitSha: handoff.integrationCommitSha,
      summary: handoff.summary,
      liveUrl: handoff.liveUrl,
      artifactUrls: handoff.artifactUrls,
      verificationReport: handoff.verificationReport,
      auditBundle: audit,
      lastError: handoff.lastError,
      attemptCount: handoff.attemptCount,
      nextAttemptAt: handoff.nextAttemptAt,
      reviewedBy: handoff.reviewedBy,
      reviewerFeedback: handoff.reviewerFeedback,
      reviewerApprovedAt: handoff.reviewerApprovedAt,
      clientReviewDueAt: handoff.clientReviewDueAt,
      clientFeedback: handoff.clientFeedback,
      clientAcceptedAt: handoff.clientAcceptedAt,
      metadata: handoff.metadata,
      createdAt: handoff.createdAt,
      updatedAt: handoff.updatedAt,
    };
  }

  private pullRequestNumber(url: string) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const number = Number(parts[3]);
      if (parts[2] !== 'pull' || !Number.isSafeInteger(number) || number <= 0)
        throw new Error();
      return number;
    } catch {
      throw new BadRequestException('The approved pull-request URL is invalid');
    }
  }

  private clientReviewHours() {
    const value = Number(
      this.config.get<string>('CLIENT_REVIEW_WINDOW_HOURS') ?? 72,
    );
    return Number.isFinite(value) ? Math.min(336, Math.max(24, value)) : 72;
  }

  private databaseErrorCode(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const direct = (error as { code?: unknown }).code;
    if (typeof direct === 'string') return direct;
    const driver = (error as { driverError?: { code?: unknown } }).driverError;
    return typeof driver?.code === 'string' ? driver.code : null;
  }

  private strings(value: unknown): string[] {
    if (Array.isArray(value))
      return value.filter(
        (item): item is string =>
          typeof item === 'string' && Boolean(item.trim()),
      );
    const record = this.record(value);
    return Array.isArray(record.items)
      ? record.items.filter(
          (item): item is string =>
            typeof item === 'string' && Boolean(item.trim()),
        )
      : [];
  }

  private unique(values: string[]) {
    return [
      ...new Set(
        values.map((value) => value.trim().slice(0, 4_000)).filter(Boolean),
      ),
    ].slice(0, 250);
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value : '';
  }

  private error(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
