import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { DeliveryService } from 'src/delivery/delivery.service';
import { ProjectHandoffsService } from 'src/delivery/project-handoffs.service';
import { ReviewProjectHandoffDto } from 'src/delivery/dtos/review-project-handoff.dto';
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
import { PlanningSubmissionsService } from 'src/planning/planning-submissions.service';
import { ProjectPlansService } from 'src/planning/project-plans.service';
import { ProjectPlan } from 'src/projects/entities/project-plan.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { ProjectHandoff } from 'src/projects/entities/project-handoff.entity';
import { Project } from 'src/projects/entities/project.entity';

const ACTIVE_REVIEWER_STATUSES = ['accepted', 'in_progress', 'completed'];

@Injectable()
export class ReviewerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly planningSubmissions: PlanningSubmissionsService,
    private readonly plans: ProjectPlansService,
    private readonly matching: MatchingService,
    private readonly delivery: DeliveryService,
    private readonly handoffs: ProjectHandoffsService,
    private readonly releases: PaymentReleaseRequestsService,
  ) {}

  async listProjects(userId: string) {
    const assignments = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .find({
        where: {
          phase: 'governance',
          roleKey: 'principal_reviewer',
          status: In(ACTIVE_REVIEWER_STATUSES),
          freelancerProfile: { userId },
        },
        relations: { project: true },
        order: { assignedAt: 'DESC' },
      });
    return assignments.map((assignment) => ({
      assignmentId: assignment.id,
      status: assignment.status,
      acceptedAt: assignment.acceptedAt,
      budgetAmount: assignment.budgetAmount,
      currency: assignment.currency,
      project: assignment.project,
    }));
  }

  async overview(projectId: string, userId: string) {
    await this.assertReviewer(projectId, userId);
    const project = await this.dataSource.getRepository(Project).findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const [
      planningAwaitingReview,
      generatedPlans,
      matchingRuns,
      submissionsAwaitingReview,
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
        .getCount(),
      this.dataSource.getRepository(ProjectSubmission).count({
        where: { projectId, status: In(['submitted', 'under_review']) },
      }),
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
      project,
      attention: {
        planningAwaitingReview,
        generatedPlans,
        matchingRuns,
        submissionsAwaitingReview,
        releaseRequests,
        openTasks,
        finalHandoffsAwaitingReview,
      },
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
    return this.matching.listRuns(projectId, { page: 1, limit: 100 });
  }

  async getMatchingRun(id: string, userId: string) {
    const item = await this.dataSource.getRepository(MatchingRun).findOne({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!item) throw new NotFoundException('Matching run not found');
    await this.assertReviewer(item.projectId, userId);
    const run = await this.matching.getRun(id);
    return {
      ...run,
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

  private adminIdentity(userId: string): JwtPayload {
    return { sub: userId, role: UserRole.ADMIN };
  }

  private planningIdentity(userId: string) {
    return { userId, role: UserRole.ADMIN };
  }
}
