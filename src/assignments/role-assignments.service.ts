import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AiService } from 'src/agents/ai.service';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Brief } from 'src/projects/entities/brief.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { MatchingCandidate } from 'src/matching/entities/matching-candidate.entity';
import {
  assessPlanningRequirementProfile,
  type PlanningComplexity,
} from 'src/planning/planning-evaluation-requirements';
import {
  planningRoleAllocation,
  requiredProjectTotalForRate,
} from 'src/planning/project-budget-allocation';
import { CreateRoleAssignmentDto } from './dtos/create-role-assignment.dto';
import { UpdateAssignmentStatusDto } from './dtos/update-assignment-status.dto';
import { confirmedBriefValue } from './confirmed-brief-value';

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
  private readonly logger = new Logger(RoleAssignmentsService.name);

  constructor(
    @InjectRepository(ProjectRoleAssignment)
    private readonly assignmentRepo: Repository<ProjectRoleAssignment>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectTask)
    private readonly taskRepo: Repository<ProjectTask>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(MatchingCandidate)
    private readonly candidateRepo: Repository<MatchingCandidate>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    private readonly aiService: AiService,
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
    this.assertProjectFullyFunded(project);
    const brief = await this.briefRepo.findOne({ where: { projectId } });

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
      relations: ['user', 'skillScores'],
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    if (profile.verificationStatus !== 'approved') {
      throw new BadRequestException(
        'Only approved freelancers can be assigned',
      );
    }
    const compensation = this.assertPlanningCompensationCoverage(
      project,
      dto.roleKey,
      profile,
    );

    const assignment = await this.dataSource.transaction(async (manager) => {
      await this.assertNoActiveAssignment(manager, projectId, dto.roleKey);
      await this.assertPlanningRoleSeparation(
        manager,
        projectId,
        freelancerProfileId!,
        dto.roleKey,
      );

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
          budgetAmount: compensation.amount,
          currency: compensation.currency,
          estimatedHours: compensation.estimatedHours,
          availabilityHoursSnapshot: profile.availabilityHoursPerWeek ?? null,
          scoreSnapshot: candidate
            ? {
                matchingCandidateId: candidate.id,
                score: Number(candidate.score),
              }
            : null,
          decisionReason: dto.decisionReason ?? null,
          notes: dto.notes ?? null,
          roleBrief: this.buildLocalRoleBrief(dto.roleKey, project, brief),
          roleBriefStatus: 'fallback',
          roleBriefGeneratedAt: new Date(),
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

    void this.generateAndPersistAiRoleBrief(assignment.id);

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
      relations: [
        'freelancerProfile',
        'freelancerProfile.user',
        'freelancerProfile.skillScores',
      ],
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
      relations: [
        'freelancerProfile',
        'freelancerProfile.user',
        'freelancerProfile.skillScores',
      ],
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

    const assignments =
      !query.phase || query.phase === 'planning'
        ? await this.assignmentRepo.find({
            where: {
              freelancerProfileId: profile.id,
              ...(query.phase ? { phase: query.phase } : {}),
              ...(query.statuses?.length ? { status: In(query.statuses) } : {}),
            },
            order: { createdAt: 'DESC' },
            relations: ['project'],
          })
        : [];

    const briefs = await this.getBriefSummaries(
      assignments.map((assignment) => assignment.projectId),
    );
    const planningData = assignments.map((assignment) => {
      const project = assignment.project;
      return {
        assignmentId: assignment.id,
        projectId: assignment.projectId,
        projectTitle: project?.title ?? null,
        phase: assignment.phase,
        roleKey: assignment.roleKey,
        status: assignment.status,
        allocatedAmount:
          assignment.budgetAmount == null
            ? null
            : Number(assignment.budgetAmount),
        currency: assignment.currency ?? project?.currency ?? null,
        deadline: project?.deadline ?? null,
        briefSummary: briefs.get(assignment.projectId) ?? null,
        roleBriefSummary: this.assignmentRoleBriefSummary(assignment),
        roleBriefStatus: assignment.roleBriefStatus,
        nextAction: this.assignmentNextAction(
          assignment.status,
          assignment.roleKey,
        ),
      };
    });

    const implementationTasks =
      !query.phase || query.phase === 'implementation'
        ? await this.taskRepo.find({
            where: {
              assignedFreelancerProfileId: profile.id,
              status: In([
                'todo',
                'blocked',
                'in_progress',
                'review',
                'changes_requested',
                'done',
              ]),
            },
            order: { assignedAt: 'DESC', createdAt: 'DESC' },
            relations: ['project'],
          })
        : [];

    const tasksByProject = new Map<string, ProjectTask[]>();
    for (const task of implementationTasks) {
      tasksByProject.set(task.projectId, [
        ...(tasksByProject.get(task.projectId) ?? []),
        task,
      ]);
    }

    const implementationData = [...tasksByProject.entries()]
      .map(([projectId, tasks]) => {
        const project = tasks[0]?.project;
        const roleKeys = [
          ...new Set(
            tasks
              .map((task) => task.roleKey)
              .filter((roleKey): roleKey is string => Boolean(roleKey)),
          ),
        ];
        const status = tasks.every((task) => task.status === 'done')
          ? 'completed'
          : tasks.some((task) =>
                ['in_progress', 'review', 'changes_requested'].includes(
                  task.status,
                ),
              )
            ? 'in_progress'
            : 'assigned';
        const budgetedTasks = tasks.filter(
          (task) => task.budgetAmount != null && task.currency != null,
        );
        const allocatedAmount = budgetedTasks.length
          ? budgetedTasks.reduce(
              (sum, task) => sum + (Number(task.budgetAmount) || 0),
              0,
            )
          : null;
        const taskCurrencies = [
          ...new Set(
            tasks
              .map((task) => task.currency?.trim().toUpperCase())
              .filter((currency): currency is string => Boolean(currency)),
          ),
        ];
        return {
          assignmentId: `implementation:${projectId}`,
          projectId,
          projectTitle: project?.title ?? null,
          phase: 'implementation',
          roleKey: roleKeys.length === 1 ? roleKeys[0] : 'implementation',
          status,
          allocatedAmount,
          currency:
            taskCurrencies.length === 1
              ? taskCurrencies[0]
              : (project?.currency ?? null),
          deadline: project?.deadline ?? null,
          briefSummary: `${tasks.length} assigned implementation task${tasks.length === 1 ? '' : 's'}`,
          roleBriefSummary: tasks
            .slice(0, 3)
            .map((task) => task.title)
            .join(', '),
          roleBriefStatus: 'task_contract',
          nextAction: `Open ${tasks.length} implementation task${tasks.length === 1 ? '' : 's'}`,
        };
      })
      .filter(
        (item) =>
          !query.statuses?.length || query.statuses.includes(item.status),
      );

    const combined = [...implementationData, ...planningData];
    const total = combined.length;
    const start = (query.page - 1) * query.limit;
    return { data: combined.slice(start, start + query.limit), total };
  }

  async freelancerProjectAssignment(userId: string, projectId: string) {
    const profile = await this.getProfileByUser(userId);
    if (!profile) {
      throw new NotFoundException('Freelancer profile not found');
    }

    const assignments = await this.assignmentRepo.find({
      where: {
        projectId,
        freelancerProfileId: profile.id,
        phase: 'planning',
        status: In(['assigned', 'accepted', 'in_progress', 'completed']),
      },
      order: { createdAt: 'DESC' },
      relations: ['project', 'freelancerProfile', 'freelancerProfile.user'],
    });
    const implementationTasks = await this.taskRepo.find({
      where: {
        projectId,
        assignedFreelancerProfileId: profile.id,
      },
      order: { assignedAt: 'DESC', createdAt: 'DESC' },
      relations: ['project'],
    });
    if (!assignments.length && !implementationTasks.length) {
      throw new NotFoundException('Assigned project not found');
    }

    const brief = await this.briefRepo.findOne({ where: { projectId } });
    for (const assignment of assignments) {
      const roleBriefVersion = (
        assignment.roleBrief as { generationVersion?: unknown } | null
      )?.generationVersion;
      if (!assignment.roleBrief || roleBriefVersion !== 3) {
        assignment.roleBrief = this.buildLocalRoleBrief(
          assignment.roleKey,
          assignment.project,
          brief,
        );
        assignment.roleBriefStatus = 'fallback';
        assignment.roleBriefGeneratedAt = new Date();
        await this.assignmentRepo.save(assignment);
        void this.generateAndPersistAiRoleBrief(assignment.id);
      }
    }

    const project = assignments[0]?.project ?? implementationTasks[0].project;
    const budgetedImplementationTasks = implementationTasks.filter(
      (task) => task.budgetAmount != null && task.currency != null,
    );
    const implementationAllocatedAmount = budgetedImplementationTasks.length
      ? budgetedImplementationTasks.reduce(
          (sum, task) => sum + (Number(task.budgetAmount) || 0),
          0,
        )
      : null;
    const implementationCurrencies = [
      ...new Set(
        implementationTasks
          .map((task) => task.currency?.trim().toUpperCase())
          .filter((currency): currency is string => Boolean(currency)),
      ),
    ];

    return {
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        planningStatus: project.planningStatus,
        currency: project.currency,
        deadline: project.deadline,
        isDeadlineFlexible: project.isDeadlineFlexible,
      },
      brief: {
        summary: confirmedBriefValue(brief?.summary),
        briefText: confirmedBriefValue(brief?.briefText),
        businessDomain: confirmedBriefValue(brief?.domain),
        mainGoal: confirmedBriefValue(brief?.mainGoal),
        targetUsers: confirmedBriefValue(brief?.targetUsers),
        coreFeatures: confirmedBriefValue(brief?.coreFeatures),
        platforms: confirmedBriefValue(brief?.platforms),
        constraintsPreferences: confirmedBriefValue(
          brief?.constraintsPreferences,
        ),
      },
      assignments: assignments.map((assignment) =>
        this.toAssignmentDto(assignment, assignment.freelancerProfile),
      ),
      implementationTaskCount: implementationTasks.length,
      implementationCompensation: {
        allocatedAmount: implementationAllocatedAmount,
        currency:
          implementationCurrencies.length === 1
            ? implementationCurrencies[0]
            : project.currency,
      },
    };
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

  private async assertPlanningRoleSeparation(
    manager: EntityManager,
    projectId: string,
    freelancerProfileId: string,
    roleKey: string,
  ) {
    const conflicting = await manager.findOne(ProjectRoleAssignment, {
      where: {
        projectId,
        phase: 'planning',
        freelancerProfileId,
        status: In(['assigned', 'accepted', 'in_progress', 'completed']),
      },
    });
    if (conflicting && conflicting.roleKey !== roleKey) {
      throw new ConflictException(
        'Architecture and UI/UX planning roles must be assigned to different freelancers',
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
      summaries.set(brief.projectId, confirmedBriefValue(brief.summary));
    }
    return summaries;
  }

  private async generateAndPersistAiRoleBrief(assignmentId: string) {
    try {
      const assignment = await this.assignmentRepo.findOne({
        where: { id: assignmentId },
        relations: ['project', 'freelancerProfile', 'freelancerProfile.user'],
      });
      if (!assignment || !assignment.project) return;

      const brief = await this.briefRepo.findOne({
        where: { projectId: assignment.projectId },
      });
      const requirementProfile = assessPlanningRequirementProfile(
        assignment.project,
        brief,
      );
      const result = await this.aiService.generateRoleBrief({
        assignmentId: assignment.id,
        roleKey: assignment.roleKey,
        project: this.projectRoleBriefInput(assignment.project),
        brief: {
          ...(this.briefRoleBriefInput(brief) ?? {}),
          coreFeatures: requirementProfile.features,
        },
        requirementProfile,
        standardExpectations: this.standardRoleExpectations(
          assignment.roleKey,
          requirementProfile.complexity,
        ),
        freelancer: assignment.freelancerProfile
          ? {
              id: assignment.freelancerProfile.id,
              headline: assignment.freelancerProfile.headline,
              skills: assignment.freelancerProfile.skills ?? [],
              yearsExperience: assignment.freelancerProfile.yearsExperience,
            }
          : null,
      });

      const update: QueryDeepPartialEntity<ProjectRoleAssignment> = {
        roleBrief: {
          ...result,
          generationVersion: 3,
          requirementProfile,
        },
        roleBriefStatus: result.source === 'fastapi' ? 'generated' : 'fallback',
        roleBriefGeneratedAt: new Date(),
        roleBriefError: null,
      };
      await this.assignmentRepo.update(assignment.id, update);
    } catch (error) {
      await this.assignmentRepo.update(assignmentId, {
        roleBriefStatus: 'fallback',
        roleBriefError:
          error instanceof Error
            ? error.message
            : 'Role brief generation failed',
      });
      this.logger.warn(
        `Role brief AI enrichment failed for assignment ${assignmentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private buildLocalRoleBrief(
    roleKey: string,
    project: Project,
    brief: Brief | null,
  ) {
    const roleLabel = this.roleLabel(roleKey);
    const projectName = project.title || 'this project';
    const domainValue = confirmedBriefValue(brief?.domain);
    const summaryValue = confirmedBriefValue(brief?.summary);
    const mainGoalValue = confirmedBriefValue(brief?.mainGoal);
    const domain = domainValue ? ` in ${domainValue}` : '';
    const requirementProfile = assessPlanningRequirementProfile(project, brief);
    const complexity = requirementProfile.complexity;
    const commonInputs = [
      'Confirmed requirements brief',
      'Project goal, users, core features, target platforms, budget, and deadline',
      'Customer constraints, preferences, and any open assumptions',
    ];

    return {
      generationVersion: 3,
      requirementProfile,
      title: `${roleLabel} planning brief for ${projectName}`,
      summary: [
        `${roleLabel} assignment for ${projectName}${domain}.`,
        project.description
          ? `Project description: ${project.description}.`
          : null,
        summaryValue ? `Brief summary: ${summaryValue}.` : null,
        mainGoalValue ? `Main goal: ${mainGoalValue}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      objectives: this.roleObjectives(roleKey, complexity),
      responsibilities: this.standardRoleExpectations(roleKey, complexity),
      requiredInputs: commonInputs,
      expectedDeliverables: this.expectedRoleDeliverables(roleKey, complexity),
      acceptanceCriteria: [
        'The deliverable is specific to this project, not a generic template.',
        'Confirmed decisions and assumptions are clearly separated.',
        'The Scrum Master can create milestones/tasks from it without inventing major missing pieces.',
      ],
      handoffChecklist: [
        'Confirmed decisions',
        'Open questions',
        'Risks and mitigations',
        'Dependencies that affect implementation order',
      ],
      collaborationNotes:
        'Ask focused questions if something is ambiguous. Keep the language clear enough for the customer and concrete enough for engineering handoff.',
      suggestedQuestions: [
        'What decision needs customer/admin confirmation before this deliverable can be final?',
      ],
      constraints: this.textToList(brief?.constraintsPreferences),
      source: 'local_fallback',
    };
  }

  private projectRoleBriefInput(project: Project) {
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      planningStatus: project.planningStatus,
      budgetMin: Number(project.budgetMin),
      budgetMax: Number(project.budgetMax),
      currency: project.currency,
      deadline: project.deadline,
      isDeadlineFlexible: project.isDeadlineFlexible,
    };
  }

  private briefRoleBriefInput(brief: Brief | null) {
    if (!brief) return null;
    return {
      id: brief.id,
      summary: confirmedBriefValue(brief.summary),
      briefText: confirmedBriefValue(brief.briefText),
      projectType: confirmedBriefValue(brief.projectType),
      businessDomain: confirmedBriefValue(brief.domain),
      mainGoal: confirmedBriefValue(brief.mainGoal),
      targetUsers: confirmedBriefValue(brief.targetUsers),
      coreFeatures: this.textToList(brief.coreFeatures),
      platforms: this.textToList(brief.platforms),
      deliverables: this.textToList(brief.deliverablesText),
      constraintsPreferences: this.textToList(brief.constraintsPreferences),
      clientBackground: confirmedBriefValue(brief.clientBackground),
      requiredSkills: brief.requiredSkills,
      preferredSkills: brief.preferredSkills,
      technical: brief.technical,
      nonFunctional: brief.nonFunctional,
      acceptanceCriteria: brief.acceptanceCriteria,
    };
  }

  private standardRoleExpectations(
    roleKey: string,
    complexity: PlanningComplexity = 'standard',
  ) {
    if (complexity === 'trivial') {
      return roleKey === 'ui_ux'
        ? [
            'Define the one in-scope screen with exact content, hierarchy, spacing, typography, and colors.',
            'Document only relevant responsive and accessibility behavior.',
            'Provide a lightweight frontend handoff; Figma, a prototype, and a full design system are optional.',
          ]
        : [
            'Choose the smallest suitable static, serverless, or monolithic solution and explain the cost trade-off.',
            'Define exact acceptance, repository, deployment, and live-link handoff details.',
            'Explicitly identify backend, API, database, authentication, or integration concerns that do not apply instead of designing them.',
          ];
    }

    if (roleKey === 'ui_ux') {
      return [
        'Map the primary user journeys and admin/staff journeys.',
        'Define only applicable screens, states, edge cases, empty states, and validation behavior.',
        'Choose a clean design direction aligned with the customer preferences and project domain.',
        'Document reusable components and responsive rules in proportion to the number of screens.',
        'Call out UX risks and unresolved product decisions.',
      ];
    }

    return [
      'Define the system architecture and major technical decisions.',
      'Describe only applicable modules, data ownership, API boundaries, and third-party integrations.',
      'Identify relevant security, performance, reliability, deployment, and observability concerns without inventing infrastructure.',
      'List implementation dependencies and risky unknowns.',
      'Provide a handoff that the Scrum Master can convert into milestones and tasks.',
    ];
  }

  private expectedRoleDeliverables(
    roleKey: string,
    complexity: PlanningComplexity,
  ) {
    if (complexity === 'trivial') {
      return roleKey === 'ui_ux'
        ? [
            'One inspectable screen specification or mockup',
            'Responsive and accessibility notes',
            'Exact content, style values, assets, and frontend acceptance checklist',
          ]
        : [
            'Minimal solution and hosting decision',
            'Scope boundaries and essential quality checks',
            'Repository, deployment, verification, rollback, and live-link handoff',
          ];
    }
    return roleKey === 'ui_ux'
      ? [
          'In-scope user flows and screen inventory',
          'Implementation-ready designs without duplicate artifact ceremony',
          'Proportionate design rules, responsive behavior, accessibility, and states',
          'Developer handoff notes and unresolved questions',
        ]
      : [
          'Architecture overview and recommended stack',
          'Applicable module or service boundaries',
          'Applicable data, API, security, integration, and operational contracts',
          'Implementation risks, dependency order, and handoff checkpoints',
        ];
  }

  private roleObjectives(roleKey: string, complexity: PlanningComplexity) {
    if (complexity === 'trivial') {
      return roleKey === 'ui_ux'
        ? [
            'Define the single in-scope screen clearly enough to implement.',
            'Keep responsive, accessibility, content, and visual decisions proportionate to the small scope.',
          ]
        : [
            'Choose the smallest practical solution for the confirmed result and budget.',
            'Give implementation, deployment, and acceptance details without inventing services or contracts.',
          ];
    }
    return roleKey === 'ui_ux'
      ? [
          'Turn the requirements into clear in-scope user journeys and screens.',
          'Define first-version UX, responsive behavior, accessibility, and visual direction.',
          'Prepare a handoff that lets frontend developers build without guessing.',
        ]
      : [
          'Turn the requirements into a practical technical architecture.',
          'Define only applicable system, data, API, integration, and operational boundaries.',
          'Prepare a handoff the Scrum Master can split into dependency-aware work.',
        ];
  }

  private assignmentRoleBriefSummary(assignment: ProjectRoleAssignment) {
    const roleBrief = assignment.roleBrief as {
      summary?: unknown;
      title?: unknown;
    } | null;
    return (
      this.optionalString(roleBrief?.summary) ??
      this.optionalString(roleBrief?.title) ??
      null
    );
  }

  private roleLabel(roleKey: string) {
    if (roleKey === 'ui_ux' || roleKey === 'uiux') return 'UI/UX';
    if (roleKey === 'architect' || roleKey === 'architecture') {
      return 'Architecture';
    }
    return roleKey.replace(/_/g, ' ');
  }

  private textToList(value?: string | null) {
    const confirmed = confirmedBriefValue(value);
    if (!confirmed) return [];
    return confirmed
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter((item) => confirmedBriefValue(item) !== null);
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
      roleBriefStatus: assignment.roleBriefStatus,
    };
    if (options?.publicOnly) return base;
    return {
      ...base,
      roleBrief: assignment.roleBrief,
      roleBriefGeneratedAt: assignment.roleBriefGeneratedAt,
      roleBriefError: assignment.roleBriefError,
      hourlyRateSnapshot: assignment.hourlyRateSnapshot,
      allocatedAmount:
        assignment.budgetAmount == null
          ? null
          : Number(assignment.budgetAmount),
      budgetAmount: assignment.budgetAmount,
      currency: assignment.currency,
      estimatedHours: assignment.estimatedHours,
      availabilityHoursSnapshot: assignment.availabilityHoursSnapshot,
      scoreSnapshot: assignment.scoreSnapshot,
      startedAt: assignment.startedAt,
      completedAt: assignment.completedAt,
      declinedAt: assignment.declinedAt,
      endedAt: assignment.endedAt,
    };
  }

  private assertProjectFullyFunded(project: Project) {
    const quote = Number(project.quotedAmount);
    const held = Number(project.heldAmount);
    if (!Number.isFinite(quote) || quote <= 0 || !project.budgetAllocation) {
      throw new ConflictException(
        'Project compensation is not allocated yet. Confirm the brief and generate a valid quote before assigning planning roles.',
      );
    }
    if (!Number.isFinite(held) || held + 0.005 < quote) {
      const remaining = Math.max(quote - (Number.isFinite(held) ? held : 0), 0);
      throw new ConflictException(
        `Planning assignments require fully funded escrow. Fund the remaining ${remaining.toFixed(2)} ${project.quotedCurrency ?? project.currency} first.`,
      );
    }
  }

  private assertPlanningCompensationCoverage(
    project: Project,
    roleKey: string,
    profile: FreelancerProfile,
  ) {
    const allocation = planningRoleAllocation(
      project.budgetAllocation,
      roleKey,
    );
    if (!allocation) {
      throw new ConflictException(
        `No compensation allocation exists for the ${roleKey} role`,
      );
    }
    const hourlyRate = Number(profile.hourlyRate);
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      throw new ConflictException(
        'The selected freelancer must set a positive hourly rate before budget coverage can be verified',
      );
    }
    const expectedCost = hourlyRate * allocation.estimatedHours;
    if (expectedCost > Number(allocation.amount) + 0.005) {
      const requiredTotal = requiredProjectTotalForRate(
        hourlyRate,
        roleKey as 'architect' | 'ui_ux',
        allocation.estimatedHours,
      );
      throw new ConflictException(
        `The selected ${roleKey} freelancer is expected to cost ${expectedCost.toFixed(2)} ${project.quotedCurrency ?? project.currency}, above the ${allocation.amount} allocation. Increase the project total to at least ${requiredTotal} or choose a freelancer within ${allocation.maxHourlyRate}/hour.`,
      );
    }
    return {
      amount: allocation.amount,
      currency: project.quotedCurrency ?? project.currency,
      estimatedHours: allocation.estimatedHours,
    };
  }

  private buildPublicFreelancer(profile?: FreelancerProfile | null) {
    if (!profile) return null;
    const scoredSkills = (profile.skillScores ?? [])
      .map((entry) => ({
        skill: entry.skill,
        score: Number(entry.score),
      }))
      .filter((entry) => entry.skill && Number.isFinite(entry.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    const fallbackSkills = (profile.skills ?? []).slice(0, 6).map((skill) => ({
      skill,
      score: null,
    }));

    return {
      id: profile.id,
      name: this.fullName(profile.user),
      headline: profile.headline,
      topSkills: scoredSkills.length ? scoredSkills : fallbackSkills,
    };
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }
}
