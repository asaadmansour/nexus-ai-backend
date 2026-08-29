import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { DeliveryService } from 'src/delivery/delivery.service';
import { EvaluationsService } from 'src/evaluations/evaluations.service';
import { ProjectHandoffsService } from 'src/delivery/project-handoffs.service';
import { ReviewProjectHandoffDto } from 'src/delivery/dtos/review-project-handoff.dto';
import { CreateProjectRatingDto } from 'src/delivery/dtos/create-project-rating.dto';
import { ReviewSubmissionDto } from 'src/delivery/dtos/review-submission.dto';
import { MatchingRun } from 'src/matching/entities/matching-run.entity';
import { ReviewRunDto } from 'src/matching/dtos/review-run.dto';
import { MatchingService } from 'src/matching/matching.service';
import { ReviewPaymentReleaseRequestDto } from 'src/payments/dtos/review-payment-release-request.dto';
import { PaymentReleaseRequest } from 'src/payments/entities/payment-release-request.entity';
import { PaymentReleaseRequestsService } from 'src/payments/payment-release-requests.service';
import { MaterializePlanDto } from 'src/planning/dtos/materialize-plan.dto';
import { ReviewPlanDto } from 'src/planning/dtos/review-plan.dto';
import { ReviewPlanningSubmissionDto } from 'src/planning/dtos/review-planning-submission.dto';
import { PlanningEvaluationsService } from 'src/planning/planning-evaluations.service';
import { PlanningSubmissionsService } from 'src/planning/planning-submissions.service';
import { ProjectPlansService } from 'src/planning/project-plans.service';
import { ProjectPlan } from 'src/projects/entities/project-plan.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { EvaluationRun } from 'src/projects/entities/evaluation-run.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { ProjectHandoff } from 'src/projects/entities/project-handoff.entity';
import { Project } from 'src/projects/entities/project.entity';

const ACTIVE_REVIEWER_STATUSES = ['accepted', 'in_progress', 'completed'];
const FILLED_ROLE_STATUSES = [
  'assigned',
  'accepted',
  'in_progress',
  'completed',
];

@Injectable()
export class ReviewerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly planningSubmissions: PlanningSubmissionsService,
    private readonly planningEvaluations: PlanningEvaluationsService,
    private readonly plans: ProjectPlansService,
    private readonly matching: MatchingService,
    private readonly delivery: DeliveryService,
    private readonly evaluations: EvaluationsService,
    private readonly handoffs: ProjectHandoffsService,
    private readonly releases: PaymentReleaseRequestsService,
  ) {}

  async listProjects(userId: string) {
    const assignments = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.project', 'project')
      .innerJoin('assignment.freelancerProfile', 'profile')
      .where('assignment.phase = :phase', { phase: 'governance' })
      .andWhere('assignment.roleKey = :roleKey', {
        roleKey: 'principal_reviewer',
      })
      .andWhere('assignment.status IN (:...statuses)', {
        statuses: ACTIVE_REVIEWER_STATUSES,
      })
      .andWhere('profile.userId = :userId', { userId })
      .andWhere('project.deletedAt IS NULL')
      .orderBy('assignment.assignedAt', 'DESC')
      .getMany();
    return Promise.all(
      assignments.map(async (assignment) => ({
        assignmentId: assignment.id,
        status: assignment.status,
        acceptedAt: assignment.acceptedAt,
        budgetAmount: assignment.budgetAmount,
        currency: assignment.currency,
        project: assignment.project,
        attention: await this.getAttentionCounts(assignment.projectId),
      })),
    );
  }

  async overview(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    const project = await this.dataSource.getRepository(Project).findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return {
      project,
      attention: await this.getAttentionCounts(projectId),
    };
  }

  private async getAttentionCounts(projectId: string) {
    const [
      planningAwaitingReview,
      generatedPlans,
      matchingRuns,
      submissionsAwaitingReview,
      integrationIssues,
      releaseRequests,
      openTasks,
      finalHandoffsAwaitingReview,
    ] = await Promise.all([
      this.dataSource.getRepository(ProjectPlanningSubmission).count({
        where: { projectId, status: 'submitted' },
      }),
      this.dataSource.getRepository(ProjectPlan).count({
        where: { projectId, status: 'generated', isCurrent: true },
      }),
      this.dataSource
        .getRepository(MatchingRun)
        .createQueryBuilder('run')
        .where('run.project_id = :projectId', { projectId })
        .andWhere('run.status = :completed', { completed: 'completed' })
        .andWhere(
          '(run.target_role_key IS NULL OR run.target_role_key != :principalReviewer)',
          { principalReviewer: 'principal_reviewer' },
        )
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM project_invitations invitation
            WHERE invitation.matching_run_id = run.id
              AND invitation.status IN ('pending', 'accepting', 'accepted')
          )`,
        )
        .andWhere(
          `(run.target_type = 'task' OR NOT EXISTS (
            SELECT 1 FROM project_role_assignments assignment
            WHERE assignment.project_id = run.project_id
              AND assignment.role_key = run.target_role_key
              AND assignment.status IN ('assigned', 'accepted', 'in_progress', 'completed')
              AND assignment.ended_at IS NULL
          ))`,
        )
        .getCount(),
      this.dataSource.getRepository(ProjectSubmission).count({
        where: { projectId, status: In(['submitted', 'under_review']) },
      }),
      this.dataSource
        .getRepository(ProjectSubmission)
        .createQueryBuilder('submission')
        .where('submission.project_id = :projectId', { projectId })
        .andWhere("submission.status = 'approved'")
        .andWhere(
          "submission.metadata -> 'integration' ->> 'status' = 'failed'",
        )
        .getCount(),
      this.dataSource.getRepository(PaymentReleaseRequest).count({
        where: { projectId, status: In(['pending', 'approved']) },
      }),
      this.dataSource.getRepository(ProjectTask).count({
        where: {
          projectId,
          status: In([
            'todo',
            'blocked',
            'in_progress',
            'review',
            'changes_requested',
          ]),
        },
      }),
      this.dataSource.getRepository(ProjectHandoff).count({
        where: {
          projectId,
          status: In([
            'reviewer_review',
            'verification_failed',
            'client_changes_requested',
          ]),
        },
      }),
    ]);
    return {
      planningAwaitingReview,
      generatedPlans,
      matchingRuns,
      submissionsAwaitingReview,
      integrationIssues,
      releaseRequests,
      openTasks,
      finalHandoffsAwaitingReview,
    };
  }

  async listPlanningSubmissions(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    return this.planningSubmissions.list(
      projectId,
      this.planningIdentity(userId),
      { page: 1, limit: 100 },
    );
  }

  async listPlans(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    return this.plans.list(projectId, this.planningIdentity(userId), {
      page: 1,
      limit: 100,
    });
  }

  async listMatchingRuns(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    const [runs, assignments] = await Promise.all([
      this.matching.listRuns(projectId, { page: 1, limit: 100 }),
      this.getFilledRoleAssignments(projectId),
    ]);
    return {
      ...runs,
      data: runs.data.map((run) => ({
        ...run,
        selectedAssignment:
          run.targetType !== 'task' && run.targetRoleKey
            ? this.assignmentSummary(assignments.get(run.targetRoleKey) ?? null)
            : null,
      })),
    };
  }

  async getMatchingRun(id: string, userId: string) {
    const item = await this.dataSource.getRepository(MatchingRun).findOne({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!item) throw new NotFoundException('Matching run not found');
    await this.assertReviewer(item.projectId, userId);
    const [run, assignments] = await Promise.all([
      this.matching.getRun(id),
      this.getFilledRoleAssignments(item.projectId),
    ]);
    return {
      ...run,
      selectedAssignment:
        run.targetType !== 'task' && run.targetRoleKey
          ? this.assignmentSummary(assignments.get(run.targetRoleKey) ?? null)
          : null,
      candidates: run.candidates.slice(0, 3),
    };
  }

  async listSubmissions(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    return this.delivery.listProjectSubmissions(
      projectId,
      { page: 1, limit: 100 },
      this.adminIdentity(userId),
    );
  }

  async listReleaseRequests(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    return this.releases.listProject(
      projectId,
      { page: 1, limit: 100 },
      this.adminIdentity(userId),
    );
  }

  async getHandoff(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    return this.handoffs.getForReviewer(projectId);
  }

  async reviewHandoff(
    projectId: string,
    dto: ReviewProjectHandoffDto,
    userId: string,
  ) {
    await this.assertReviewer(projectId, userId);
    return this.handoffs.review(projectId, dto, userId);
  }

  async getImplementationRatings(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    return this.handoffs.getReviewerRatings(projectId, userId);
  }

  async rateImplementation(
    projectId: string,
    dto: CreateProjectRatingDto,
    userId: string,
  ) {
    await this.assertReviewer(projectId, userId);
    return this.handoffs.rateImplementationContributor(projectId, dto, userId);
  }

  async getPlanningSubmission(id: string, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectPlanningSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);
    return this.planningSubmissions.getById(id, this.planningIdentity(userId));
  }

  async getPlan(id: string, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectPlan)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Plan not found');
    await this.assertReviewer(item.projectId, userId);
    return this.plans.getById(id, this.planningIdentity(userId));
  }

  async getSubmission(id: string, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);
    return this.delivery.getSubmission(id, this.adminIdentity(userId));
  }

  async reviewPlanningSubmission(
    id: string,
    dto: ReviewPlanningSubmissionDto,
    userId: string,
  ) {
    const item = await this.dataSource
      .getRepository(ProjectPlanningSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);
    return this.planningSubmissions.review(id, dto, userId);
  }

  async retryPlanningSubmissionEvaluation(id: string, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectPlanningSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);
    return this.planningEvaluations.retry(id, userId);
  }

  async reviewPlan(id: string, dto: ReviewPlanDto, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectPlan)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Plan not found');
    await this.assertReviewer(item.projectId, userId);
    return this.plans.review(id, dto, userId);
  }

  async materializePlan(id: string, dto: MaterializePlanDto, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectPlan)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Plan not found');
    await this.assertReviewer(item.projectId, userId);
    return this.plans.materialize(id, dto, userId);
  }

  async reviewMatchingRun(id: string, dto: ReviewRunDto, userId: string) {
    const item = await this.dataSource
      .getRepository(MatchingRun)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Matching run not found');
    await this.assertReviewer(item.projectId, userId);
    return this.matching.reviewRunWithInvitation(id, dto, userId);
  }

  async reviewSubmission(id: string, dto: ReviewSubmissionDto, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);
    return this.delivery.reviewSubmission(
      id,
      dto,
      this.adminIdentity(userId),
      'principal_reviewer',
    );
  }

  async retrySubmissionEvaluation(id: string, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);

    const latestRun = await this.dataSource
      .getRepository(EvaluationRun)
      .findOne({ where: { submissionId: id }, order: { createdAt: 'DESC' } });
    if (latestRun) {
      return this.evaluations.retryRun(
        latestRun.id,
        { reason: 'principal_reviewer_retry' },
        userId,
      );
    }
    return this.evaluations.queueForSubmission(
      id,
      { mode: 'async', reason: 'principal_reviewer_retry' },
      userId,
    );
  }

  async retargetSubmissionPullRequest(id: string, userId: string) {
    const item = await this.dataSource
      .getRepository(ProjectSubmission)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Submission not found');
    await this.assertReviewer(item.projectId, userId);
    return this.delivery.retargetSubmissionPullRequest(
      id,
      this.adminIdentity(userId),
    );
  }

  async reviewReleaseRequest(
    id: string,
    dto: ReviewPaymentReleaseRequestDto,
    user: JwtPayload,
  ) {
    const item = await this.dataSource
      .getRepository(PaymentReleaseRequest)
      .findOne({ where: { id }, select: { id: true, projectId: true } });
    if (!item) throw new NotFoundException('Release request not found');
    await this.assertReviewer(item.projectId, user.sub);
    return this.releases.review(id, dto, user);
  }

  private async assertReviewer(projectId: string, userId: string) {
    if (!(await this.matching.isPrincipalReviewer(userId, projectId))) {
      throw new ForbiddenException(
        'You are not the active principal reviewer for this project',
      );
    }
  }

  private async getFilledRoleAssignments(projectId: string) {
    const assignments = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .find({
        where: {
          projectId,
          status: In(FILLED_ROLE_STATUSES),
          endedAt: IsNull(),
        },
        relations: ['freelancerProfile', 'freelancerProfile.user'],
        order: { updatedAt: 'DESC' },
      });
    const byRole = new Map<string, ProjectRoleAssignment>();
    for (const assignment of assignments) {
      if (!byRole.has(assignment.roleKey)) {
        byRole.set(assignment.roleKey, assignment);
      }
    }
    return byRole;
  }

  private assignmentSummary(assignment: ProjectRoleAssignment | null) {
    if (!assignment) return null;
    const user = assignment.freelancerProfile?.user;
    return {
      id: assignment.id,
      roleKey: assignment.roleKey,
      status: assignment.status,
      freelancerProfileId: assignment.freelancerProfileId,
      sourceMatchingRunId: assignment.sourceMatchingRunId,
      sourceCandidateId: assignment.sourceCandidateId,
      freelancer: assignment.freelancerProfile
        ? {
            id: assignment.freelancerProfile.id,
            name:
              [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
              null,
            githubUsername: assignment.freelancerProfile.githubUsername,
          }
        : null,
    };
  }

  private adminIdentity(userId: string): JwtPayload {
    return { sub: userId, role: UserRole.ADMIN };
  }

  private planningIdentity(userId: string) {
    return { userId, role: UserRole.ADMIN };
  }
}
