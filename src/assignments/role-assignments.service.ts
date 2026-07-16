import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Brief } from 'src/projects/entities/brief.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { MatchingCandidate } from 'src/matching/entities/matching-candidate.entity';
import { CreateRoleAssignmentDto } from './dtos/create-role-assignment.dto';
import { UpdateAssignmentStatusDto } from './dtos/update-assignment-status.dto';

interface Requester {
  userId: string;
  role: UserRole;
}

const PLANNING_ROLES = ['architect', 'ui_ux'];
const ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress'];
const FREELANCER_ALLOWED_STATUSES = new Set([
  'accepted',
  'declined',
  'in_progress',
  'completed',
]);
const ASSIGNMENT_TRANSITIONS: Record<string, string[]> = {
  assigned: ['accepted', 'declined', 'cancelled', 'replaced'],
  accepted: ['in_progress', 'cancelled', 'replaced'],
  in_progress: ['completed', 'cancelled', 'replaced'],
  completed: ['cancelled'],
};

@Injectable()
export class RoleAssignmentsService {
  constructor(
    @InjectRepository(ProjectRoleAssignment)
    private readonly assignmentRepo: Repository<ProjectRoleAssignment>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(MatchingCandidate)
    private readonly candidateRepo: Repository<MatchingCandidate>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Create (admin)
  // ---------------------------------------------------------------------------

  async create(
    projectId: string,
    dto: CreateRoleAssignmentDto,
    adminUserId: string,
  ) {
    if (dto.phase !== 'planning') {
      throw new BadRequestException(
        'Only planning assignments are supported in this phase',
      );
    }
    if (!dto.candidateId && !dto.freelancerProfileId) {
      throw new BadRequestException(
        'Provide either candidateId or freelancerProfileId',
      );
    }

    const project = await this.getProject(projectId);

    let candidate: MatchingCandidate | null = null;
    let freelancerProfileId = dto.freelancerProfileId ?? null;
    if (dto.candidateId) {
      candidate = await this.candidateRepo.findOne({
        where: { id: dto.candidateId },
      });
      if (!candidate || !candidate.freelancerProfileId) {
        throw new NotFoundException('Matching candidate not found');
      }
      freelancerProfileId = candidate.freelancerProfileId;
    }

    const profile = await this.profileRepo.findOne({
      where: { id: freelancerProfileId! },
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    if (profile.verificationStatus !== 'approved') {
      throw new BadRequestException(
        'Only approved freelancers can be assigned',
      );
    }

    const assignment = await this.dataSource.transaction(async (manager) => {
      await this.assertNoActiveAssignment(manager, projectId, dto.roleKey);

      const created = await manager.save(
        ProjectRoleAssignment,
        manager.create(ProjectRoleAssignment, {
          projectId,
          freelancerProfileId,
          phase: 'planning',
          roleKey: dto.roleKey,
          status: 'assigned',
          sourceMatchingRunId: candidate?.matchingRunId ?? null,
          sourceCandidateId: candidate?.id ?? null,
          assignedBy: adminUserId,
          hourlyRateSnapshot: profile.hourlyRate ?? null,
          availabilityHoursSnapshot: profile.availabilityHoursPerWeek ?? null,
          scoreSnapshot: candidate
            ? {
                matchingCandidateId: candidate.id,
                score: Number(candidate.score),
              }
            : null,
          decisionReason: dto.decisionReason ?? null,
          notes: dto.notes ?? null,
          assignedAt: new Date(),
        }),
      );

      if (candidate) {
        candidate.status = 'assigned';
        await manager.save(MatchingCandidate, candidate);
      }

      await this.maybeAdvanceToPlanningAssigned(manager, project, adminUserId);
      return created;
    });

    await this.notify(profile.userId, projectId, {
      title: 'New planning assignment',
      body: `You were assigned as ${dto.roleKey} for a project.`,
    });

    return this.toAssignmentDto(assignment, profile);
  }

  // ---------------------------------------------------------------------------
  // List (role-scoped)
  // ---------------------------------------------------------------------------

  async list(projectId: string, requester: Requester) {
    const project = await this.getProject(projectId);
    this.assertProjectVisibility(project, requester);

    const assignments = await this.assignmentRepo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });

    const requesterProfileId =
      requester.role === UserRole.FREELANCER
        ? (await this.getProfileByUser(requester.userId))?.id
        : null;

    const visible =
      requester.role === UserRole.FREELANCER
        ? assignments.filter(
            (a) => a.freelancerProfileId === requesterProfileId,
          )
        : assignments;

    return visible.map((assignment) =>
      this.toAssignmentDto(assignment, assignment.freelancerProfile, {
        publicOnly: requester.role === UserRole.CUSTOMER,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Update status (freelancer / admin)
  // ---------------------------------------------------------------------------

  async updateStatus(
    assignmentId: string,
    dto: UpdateAssignmentStatusDto,
    requester: Requester,
  ) {
    const isAdmin = requester.role === UserRole.ADMIN;
    if (!isAdmin && !FREELANCER_ALLOWED_STATUSES.has(dto.status)) {
      throw new ForbiddenException('You cannot set this assignment status');
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      const assignment = await manager.findOne(ProjectRoleAssignment, {
        where: { id: assignmentId },
        relations: ['freelancerProfile'],
      });
      if (!assignment) throw new NotFoundException('Assignment not found');

      if (!isAdmin) {
        const profile = await this.getProfileByUser(requester.userId);
        if (!profile || assignment.freelancerProfileId !== profile.id) {
          throw new ForbiddenException(
            'You can only update your own assignment',
          );
        }
        this.assertTransition(assignment.status, dto.status);
      } else if (
        !ASSIGNMENT_TRANSITIONS[assignment.status]?.includes(dto.status)
      ) {
        // Admin correction is allowed, but keep it to defined transitions.
        this.assertTransition(assignment.status, dto.status);
      }

      this.applyStatusTimestamps(assignment, dto.status);
      assignment.status = dto.status;
      if (dto.notes) assignment.notes = dto.notes;
      await manager.save(ProjectRoleAssignment, assignment);

      if (dto.status === 'in_progress') {
        await this.maybeAdvanceToPlanningInProgress(
          manager,
          assignment.projectId,
          requester.userId,
        );
      }

      return assignment;
    });

    if (isAdmin && updated.freelancerProfile?.userId) {
      await this.notify(updated.freelancerProfile.userId, updated.projectId, {
        title: 'Assignment updated',
        body: `Your ${updated.roleKey} assignment is now ${updated.status}.`,
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      acceptedAt: updated.acceptedAt,
      declinedAt: updated.declinedAt,
      startedAt: updated.startedAt,
      completedAt: updated.completedAt,
      endedAt: updated.endedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Team view (customer/admin)
  // ---------------------------------------------------------------------------

  async getTeam(projectId: string, requester: Requester) {
    const project = await this.getProject(projectId);
    this.assertProjectVisibility(project, requester);

    const assignments = await this.assignmentRepo.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });

    const planningTeam = assignments
      .filter(
        (a) =>
          a.phase === 'planning' &&
          a.status !== 'cancelled' &&
          a.status !== 'replaced',
      )
      .map((a) => ({
        roleKey: a.roleKey,
        status: a.status,
        freelancer: this.buildPublicFreelancer(a.freelancerProfile),
      }));

    return {
      projectId: project.id,
      projectStatus: project.status,
      planningStatus: project.planningStatus,
      planningTeam,
      implementationTeam: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Freelancer assigned projects
  // ---------------------------------------------------------------------------

  async freelancerAssigned(
    userId: string,
    query: { phase?: string; statuses?: string[]; page: number; limit: number },
  ) {
    const profile = await this.getProfileByUser(userId);
    if (!profile) {
      return { data: [], total: 0 };
    }

    const where: Record<string, unknown> = { freelancerProfileId: profile.id };
    if (query.phase) where.phase = query.phase;
    if (query.statuses?.length) where.status = In(query.statuses);

    const [assignments, total] = await this.assignmentRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: ['project'],
    });

    const briefs = await this.getBriefSummaries(
      assignments.map((a) => a.projectId),
    );

    const data = assignments.map((assignment) => {
      const project = assignment.project;
      return {
        assignmentId: assignment.id,
        projectId: assignment.projectId,
        projectTitle: project?.title ?? null,
        phase: assignment.phase,
        roleKey: assignment.roleKey,
        status: assignment.status,
        budgetMin: project ? Number(project.budgetMin) : null,
        budgetMax: project ? Number(project.budgetMax) : null,
        currency: project?.currency ?? null,
        deadline: project?.deadline ?? null,
        briefSummary: briefs.get(assignment.projectId) ?? null,
        nextAction: this.assignmentNextAction(
          assignment.status,
          assignment.roleKey,
        ),
      };
    });

    return { data, total };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertNoActiveAssignment(
    manager: EntityManager,
    projectId: string,
    roleKey: string,
  ) {
    const existing = await manager.findOne(ProjectRoleAssignment, {
      where: { projectId, phase: 'planning', roleKey },
    });
    if (existing && ACTIVE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        `An active ${roleKey} planning assignment already exists for this project`,
      );
    }
  }

  private async maybeAdvanceToPlanningAssigned(
    manager: EntityManager,
    project: Project,
    adminUserId: string,
  ) {
    const roles = await this.activePlanningRoles(manager, project.id);
    if (!PLANNING_ROLES.every((role) => roles.has(role))) return;
    if (project.status === ProjectStatus.PLANNING_ASSIGNED) return;

    await this.transitionProject(manager, project, adminUserId, {
      status: ProjectStatus.PLANNING_ASSIGNED,
      planningStatus: 'assigned',
      reason: 'Both planning roles assigned.',
      setAssignedAt: true,
    });
  }

  private async maybeAdvanceToPlanningInProgress(
    manager: EntityManager,
    projectId: string,
    actorUserId: string,
  ) {
    const project = await manager.findOne(Project, {
      where: { id: projectId },
    });
    if (!project) return;
    if (
      project.status !== ProjectStatus.PLANNING_ASSIGNED &&
      project.status !== ProjectStatus.PLANNING_MATCHING
    ) {
      return;
    }
    await this.transitionProject(manager, project, actorUserId, {
      status: ProjectStatus.PLANNING_IN_PROGRESS,
      planningStatus: 'in_progress',
      reason: 'A planning assignment started.',
    });
  }

  private async activePlanningRoles(manager: EntityManager, projectId: string) {
    const rows = await manager
      .createQueryBuilder(ProjectRoleAssignment, 'a')
      .select('DISTINCT a.role_key', 'roleKey')
      .where('a.project_id = :projectId', { projectId })
      .andWhere('a.phase = :phase', { phase: 'planning' })
      .andWhere('a.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
      .getRawMany<{ roleKey: string }>();
    return new Set(rows.map((row) => row.roleKey));
  }

  private async transitionProject(
    manager: EntityManager,
    project: Project,
    actorUserId: string,
    change: {
      status: ProjectStatus;
      planningStatus: string;
      reason: string;
      setAssignedAt?: boolean;
    },
  ) {
    const oldStatus = project.status;
    project.status = change.status;
    project.planningStatus = change.planningStatus;
    if (change.setAssignedAt) {
      project.assignedAt = project.assignedAt ?? new Date();
    }
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

  private applyStatusTimestamps(
    assignment: ProjectRoleAssignment,
    status: string,
  ) {
    const now = new Date();
    if (status === 'accepted') assignment.acceptedAt = now;
    if (status === 'declined') {
      assignment.declinedAt = now;
      assignment.endedAt = now;
    }
    if (status === 'in_progress') assignment.startedAt = now;
    if (status === 'completed') assignment.completedAt = now;
    if (status === 'cancelled' || status === 'replaced') {
      assignment.endedAt = now;
    }
  }

  private assertTransition(from: string, to: string) {
    const allowed = ASSIGNMENT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Cannot change assignment from ${from} to ${to}`,
      );
    }
  }

  private assertProjectVisibility(project: Project, requester: Requester) {
    if (requester.role === UserRole.ADMIN) return;
    if (requester.role === UserRole.CUSTOMER) {
      if (project.customerId !== requester.userId) {
        throw new ForbiddenException('You can only access your own projects');
      }
      return;
    }
    // Freelancers reach their own assignments through list()/freelancerAssigned.
  }

  private assignmentNextAction(status: string, roleKey: string): string {
    const planType = roleKey === 'architect' ? 'architecture' : 'ui_ux';
    switch (status) {
      case 'assigned':
        return 'accept_assignment';
      case 'accepted':
      case 'in_progress':
        return `submit_${planType}_plan`;
      case 'completed':
        return 'submitted';
      case 'declined':
        return 'declined';
      default:
        return 'view_project';
    }
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

  private async getBriefSummaries(projectIds: string[]) {
    const summaries = new Map<string, string | null>();
    if (!projectIds.length) return summaries;
    const briefs = await this.briefRepo.find({
      where: { projectId: In(projectIds) },
    });
    for (const brief of briefs) {
      summaries.set(brief.projectId, brief.summary ?? null);
    }
    return summaries;
  }

  private async notify(
    userId: string,
    projectId: string,
    payload: { title: string; body: string },
  ) {
    await this.notificationsService.createNotification({
      userId,
      projectId,
      title: payload.title,
      body: payload.body,
    });
  }

  private toAssignmentDto(
    assignment: ProjectRoleAssignment,
    profile?: FreelancerProfile | null,
    options?: { publicOnly?: boolean },
  ) {
    const base = {
      id: assignment.id,
      projectId: assignment.projectId,
      phase: assignment.phase,
      roleKey: assignment.roleKey,
      status: assignment.status,
      freelancerProfileId: assignment.freelancerProfileId,
      freelancer: this.buildPublicFreelancer(profile ?? null),
      assignedAt: assignment.assignedAt,
      acceptedAt: assignment.acceptedAt,
    };
    if (options?.publicOnly) return base;
    return {
      ...base,
      hourlyRateSnapshot: assignment.hourlyRateSnapshot,
      availabilityHoursSnapshot: assignment.availabilityHoursSnapshot,
      scoreSnapshot: assignment.scoreSnapshot,
      startedAt: assignment.startedAt,
      completedAt: assignment.completedAt,
      declinedAt: assignment.declinedAt,
      endedAt: assignment.endedAt,
    };
  }

  private buildPublicFreelancer(profile?: FreelancerProfile | null) {
    if (!profile) return null;
    return {
      id: profile.id,
      name: this.fullName(profile.user),
      headline: profile.headline,
      topSkills: profile.skills ?? [],
    };
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }
}
