import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { CreatePlanningSubmissionDto } from './dtos/create-planning-submission.dto';
import { ReviewPlanningSubmissionDto } from './dtos/review-planning-submission.dto';
import { ProjectPlansService } from './project-plans.service';

interface Requester {
  userId: string;
  role: UserRole;
}

const ROLE_TO_SUBMISSION_TYPE: Record<string, string> = {
  architect: 'architecture',
  ui_ux: 'ui_ux',
};

@Injectable()
export class PlanningSubmissionsService {
  constructor(
    @InjectRepository(ProjectPlanningSubmission)
    private readonly submissionRepo: Repository<ProjectPlanningSubmission>,
    @InjectRepository(ProjectRoleAssignment)
    private readonly assignmentRepo: Repository<ProjectRoleAssignment>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    private readonly notificationsService: NotificationsService,
    private readonly projectPlansService: ProjectPlansService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Create / resubmit
  // ---------------------------------------------------------------------------

  async create(
    projectId: string,
    dto: CreatePlanningSubmissionDto,
    requester: Requester,
  ) {
    const project = await this.getProject(projectId);
    const assignment = await this.assignmentRepo.findOne({
      where: { id: dto.assignmentId },
      relations: ['freelancerProfile'],
    });
    if (!assignment || assignment.projectId !== projectId) {
      throw new NotFoundException('Assignment not found for this project');
    }

    const isAdmin = requester.role === UserRole.ADMIN;
    if (!isAdmin) {
      if (assignment.freelancerProfile?.userId !== requester.userId) {
        throw new ForbiddenException(
          'You can only submit for your own assignment',
        );
      }
    }

    if (ROLE_TO_SUBMISSION_TYPE[assignment.roleKey] !== dto.submissionType) {
      throw new BadRequestException(
        `A ${assignment.roleKey} assignment must submit ${ROLE_TO_SUBMISSION_TYPE[assignment.roleKey]}`,
      );
    }

    const status = dto.status ?? 'submitted';
    const latest = await this.submissionRepo.findOne({
      where: {
        assignmentId: assignment.id,
        submissionType: dto.submissionType,
      },
      order: { version: 'DESC' },
    });
    const version = (latest?.version ?? 0) + 1;

    const submission = await this.dataSource.transaction(async (manager) => {
      if (latest && latest.status !== 'superseded') {
        latest.status = 'superseded';
        await manager.save(ProjectPlanningSubmission, latest);
      }

      const created = await manager.save(
        ProjectPlanningSubmission,
        manager.create(ProjectPlanningSubmission, {
          projectId,
          assignmentId: assignment.id,
          freelancerProfileId: assignment.freelancerProfileId,
          submissionType: dto.submissionType,
          version,
          status,
          title: dto.title ?? null,
          summary: dto.summary ?? null,
          content: dto.content ?? null,
          fileUrls: dto.fileUrls ?? null,
          submittedAt: status === 'submitted' ? new Date() : null,
        }),
      );

      if (
        status === 'submitted' &&
        project.status === ProjectStatus.PLANNING_ASSIGNED
      ) {
        await this.transitionProject(manager, project, requester.userId, {
          status: ProjectStatus.PLANNING_IN_PROGRESS,
          planningStatus: 'in_progress',
          reason: 'A planning deliverable was submitted.',
        });
      }

      return created;
    });

    return this.toDetail(submission, assignment.freelancerProfile);
  }

  // ---------------------------------------------------------------------------
  // List / detail
  // ---------------------------------------------------------------------------

  async list(
    projectId: string,
    requester: Requester,
    query: {
      submissionType?: string;
      status?: string;
      page: number;
      limit: number;
    },
  ) {
    const project = await this.getProject(projectId);
    this.assertProjectVisibility(project, requester);

    const qb = this.submissionRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.freelancerProfile', 'p')
      .leftJoinAndSelect('p.user', 'u')
      .where('s.projectId = :projectId', { projectId })
      .orderBy('s.createdAt', 'DESC');

    if (query.submissionType) {
      qb.andWhere('s.submissionType = :type', { type: query.submissionType });
    }
    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    if (requester.role === UserRole.CUSTOMER) {
      qb.andWhere('s.status = :approved', { approved: 'approved' });
    }
    if (requester.role === UserRole.FREELANCER) {
      const profile = await this.getProfileByUser(requester.userId);
      qb.andWhere('s.freelancerProfileId = :profileId', {
        profileId: profile?.id ?? null,
      });
    }

    const [submissions, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const data = submissions.map((submission) =>
      this.toListItem(submission, submission.freelancerProfile),
    );
    return { data, total };
  }

  async getById(submissionId: string, requester: Requester) {
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });
    if (!submission) throw new NotFoundException('Submission not found');

    if (requester.role === UserRole.FREELANCER) {
      const profile = await this.getProfileByUser(requester.userId);
      if (submission.freelancerProfileId !== profile?.id) {
        throw new ForbiddenException('You can only view your own submission');
      }
    } else if (requester.role === UserRole.CUSTOMER) {
      const project = await this.getProject(submission.projectId);
      if (project.customerId !== requester.userId) {
        throw new ForbiddenException('You can only view your own project');
      }
      if (submission.status !== 'approved') {
        throw new ForbiddenException('This submission is not available yet');
      }
    }

    const detail = this.toDetail(submission, submission.freelancerProfile);
    if (requester.role === UserRole.CUSTOMER) {
      return { ...detail, adminNotes: undefined };
    }
    return detail;
  }

  // ---------------------------------------------------------------------------
  // Review (admin)
  // ---------------------------------------------------------------------------

  async review(
    submissionId: string,
    dto: ReviewPlanningSubmissionDto,
    adminUserId: string,
  ) {
    if (dto.status === 'changes_requested' && !dto.adminNotes?.trim()) {
      throw new BadRequestException(
        'adminNotes is required when requesting changes',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const submission = await manager.findOne(ProjectPlanningSubmission, {
        where: { id: submissionId },
        relations: ['freelancerProfile'],
      });
      if (!submission) throw new NotFoundException('Submission not found');

      submission.status = dto.status;
      submission.adminNotes = dto.adminNotes ?? submission.adminNotes ?? null;
      submission.reviewedBy = adminUserId;
      submission.reviewedAt = new Date();
      await manager.save(ProjectPlanningSubmission, submission);

      let planUnlocked = false;
      if (dto.status === 'approved') {
        planUnlocked = await this.maybeUnlockPlanGeneration(
          manager,
          submission.projectId,
          adminUserId,
        );
      }

      return {
        submission,
        notifyUserId: submission.freelancerProfile?.userId ?? null,
        planUnlocked,
      };
    });

    if (result.notifyUserId) {
      await this.notificationsService.createNotification({
        userId: result.notifyUserId,
        projectId: result.submission.projectId,
        title: 'Planning submission reviewed',
        body: `Your ${result.submission.submissionType} submission was ${dto.status.replace('_', ' ')}.`,
      });
    }

    const planGenerationJob = result.planUnlocked
      ? await this.enqueuePlanGenerationSafely(
          result.submission.projectId,
          adminUserId,
        )
      : null;

    return {
      id: result.submission.id,
      status: result.submission.status,
      reviewedBy: result.submission.reviewedBy,
      reviewedAt: result.submission.reviewedAt,
      planGenerationUnlocked: result.planUnlocked,
      planGenerationJob,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin queue (all projects)
  // ---------------------------------------------------------------------------

  async adminListAll(query: {
    status?: string;
    submissionType?: string;
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.submissionType) where.submissionType = query.submissionType;

    const [submissions, total] = await this.submissionRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });

    const titles = await this.getProjectTitles(
      submissions.map((s) => s.projectId),
    );

    const data = submissions.map((submission) => ({
      ...this.toListItem(submission, submission.freelancerProfile),
      projectTitle: titles.get(submission.projectId) ?? null,
    }));
    return { data, total };
  }

  private async getProjectTitles(projectIds: string[]) {
    const titles = new Map<string, string>();
    if (!projectIds.length) return titles;
    const projects = await this.projectRepo.find({
      where: projectIds.map((id) => ({ id })),
      select: { id: true, title: true },
    });
    for (const project of projects) titles.set(project.id, project.title);
    return titles;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async enqueuePlanGenerationSafely(
    projectId: string,
    adminUserId: string,
  ) {
    try {
      return await this.projectPlansService.enqueueAutomaticGeneration(
        projectId,
        adminUserId,
      );
    } catch (error) {
      return {
        queued: false,
        reason: 'queue_failed',
        error: this.getErrorMessage(error),
      };
    }
  }

  /** Returns true when both latest architecture and UI/UX submissions are approved. */
  private async maybeUnlockPlanGeneration(
    manager: EntityManager,
    projectId: string,
    adminUserId: string,
  ): Promise<boolean> {
    const architectureApproved = await this.hasApprovedLatest(
      manager,
      projectId,
      'architecture',
    );
    const uiuxApproved = await this.hasApprovedLatest(
      manager,
      projectId,
      'ui_ux',
    );
    if (!architectureApproved || !uiuxApproved) return false;

    const project = await manager.findOne(Project, {
      where: { id: projectId },
    });
    if (project && project.status !== ProjectStatus.PLANNING_REVIEW) {
      await this.transitionProject(manager, project, adminUserId, {
        status: ProjectStatus.PLANNING_REVIEW,
        planningStatus: 'under_review',
        reason: 'Both planning deliverables approved.',
      });
    }
    return true;
  }

  private async hasApprovedLatest(
    manager: EntityManager,
    projectId: string,
    submissionType: string,
  ) {
    const latest = await manager.findOne(ProjectPlanningSubmission, {
      where: { projectId, submissionType },
      order: { version: 'DESC' },
    });
    return latest?.status === 'approved';
  }

  private async transitionProject(
    manager: EntityManager,
    project: Project,
    actorUserId: string,
    change: { status: ProjectStatus; planningStatus: string; reason: string },
  ) {
    const oldStatus = project.status;
    project.status = change.status;
    project.planningStatus = change.planningStatus;
    await manager.save(Project, project);
    if (oldStatus !== change.status) {
      await manager.save(
        ProjectStatusHistory,
        manager.create(ProjectStatusHistory, {
          projectId: project.id,
          oldStatus,
          newStatus: change.status,
          changedBy: actorUserId,
          changedByType: 'admin',
          reason: change.reason,
        }),
      );
    }
  }

  private assertProjectVisibility(project: Project, requester: Requester) {
    if (
      requester.role === UserRole.CUSTOMER &&
      project.customerId !== requester.userId
    ) {
      throw new ForbiddenException('You can only access your own project');
    }
  }


  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private async getProject(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async getProfileByUser(userId: string) {
    return this.profileRepo.findOne({ where: { userId } });
  }

  private toListItem(
    submission: ProjectPlanningSubmission,
    profile?: FreelancerProfile | null,
  ) {
    return {
      id: submission.id,
      projectId: submission.projectId,
      assignmentId: submission.assignmentId,
      submissionType: submission.submissionType,
      version: submission.version,
      status: submission.status,
      title: submission.title,
      summary: submission.summary,
      freelancer: this.buildFreelancer(profile),
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
    };
  }

  private toDetail(
    submission: ProjectPlanningSubmission,
    profile?: FreelancerProfile | null,
  ) {
    return {
      ...this.toListItem(submission, profile),
      freelancerProfileId: submission.freelancerProfileId,
      content: submission.content,
      fileUrls: submission.fileUrls,
      adminNotes: submission.adminNotes,
      reviewedBy: submission.reviewedBy,
    };
  }

  private buildFreelancer(profile?: FreelancerProfile | null) {
    if (!profile) return null;
    return {
      id: profile.id,
      name: this.fullName(profile.user),
      headline: profile.headline,
    };
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }
}
