import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { AiService } from 'src/agents/ai.service';
import type { MatchFreelancersResult } from 'src/agents/ai.service';
import type { MatchCandidateInputDto } from 'src/agents/dto/MatchFreelancersDto';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Brief } from 'src/projects/entities/brief.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { TaskCheckpoint } from 'src/projects/entities/task-checkpoint.entity';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';
import {
  planningRoleAllocation,
  principalReviewerRoleAllocation,
  implementationTeamRoleAllocation,
  projectFundingBreakdown,
} from 'src/planning/project-budget-allocation';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { MatchingCandidate } from './entities/matching-candidate.entity';
import { MatchingRun } from './entities/matching-run.entity';
import { AssignTaskDto } from './dtos/assign-task.dto';
import { StartImplementationMatchingDto } from './dtos/start-implementation-matching.dto';
import {
  PlanningMatchingFiltersDto,
  StartPlanningMatchingDto,
} from './dtos/start-planning-matching.dto';
import { UpdateCandidateStatusDto } from './dtos/update-candidate-status.dto';
import { ReviewRunDto } from './dtos/review-run.dto';
import { ProjectInvitation } from './entities/project-invitation.entity';
import { FreelancerPerformanceEvent } from 'src/freelancers/entities/freelancer-performance-event.entity';
import { RepositoriesService } from 'src/repositories/repositories.service';
import {
  PRINCIPAL_REVIEWER_MAX_PROJECTS,
  PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE,
  PRINCIPAL_REVIEWER_ROLE,
  PRINCIPAL_REVIEWER_SKILLS,
} from 'src/freelancers/principal-reviewer-qualification';
import {
  normalizeCurrency,
  rateInCurrencySql,
} from 'src/common/currency/currency';

const PLANNING_ROLES = ['architect', 'ui_ux'];
function staffingRoleBase(roleKey: string) {
  return roleKey.startsWith('implementation_') ? 'implementation' : roleKey;
}

function requiredPreFundingRoles() {
  // Exact implementation roles do not exist until architecture/UI/UX have been
  // approved and the Scrum plan is materialized. The capacity sweep gates
  // planning payment, but does not invite generic developers to accept work
  // whose tasks, deadlines, and compensation are still unknown.
  return [...PLANNING_ROLES];
}
// The current staffing policy gives each candidate five hours to respond.
// Deployments may override the window explicitly, while the principal-reviewer
// deadline still covers at least two complete fallback attempts.
export function resolveInvitationTtlHours(value?: string): number {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}
const INVITATION_TTL_HOURS = resolveInvitationTtlHours(
  process.env.MATCHING_INVITATION_TTL_HOURS,
);
const INVITATION_TTL_MS = INVITATION_TTL_HOURS * 60 * 60 * 1000;
const MATCHING_FALLBACK_ATTEMPTS = (() => {
  const raw = Number(process.env.MATCHING_GUARANTEED_FALLBACK_ATTEMPTS);
  return Number.isFinite(raw) && raw >= 2 ? Math.floor(raw) : 2;
})();
const PRINCIPAL_MATCHING_WINDOW_MS =
  INVITATION_TTL_MS * MATCHING_FALLBACK_ATTEMPTS;
const EMPTY_RUN_RETRY_MS = (() => {
  const raw = Number(process.env.MATCHING_EMPTY_RUN_RETRY_MINUTES);
  return (Number.isFinite(raw) && raw > 0 ? raw : 15) * 60 * 1000;
})();
const INVITATION_WINDOW_LABEL =
  INVITATION_TTL_HOURS === 1
    ? 'one hour'
    : INVITATION_TTL_HOURS % 24 === 0 && INVITATION_TTL_HOURS >= 24
      ? INVITATION_TTL_HOURS === 24
        ? 'one day'
        : `${INVITATION_TTL_HOURS / 24} days`
      : `${INVITATION_TTL_HOURS} hours`;
const DEFAULT_LIMIT = 10;
const REVIEWER_SHORTLIST_LIMIT = 3;

// Sensible default required-skills per planning role, used when the admin does
// not pass explicit `filters.skills`. Lets the architect and ui_ux runs rank
// against role-relevant skills instead of one shared list.
const PLANNING_ROLE_SKILLS: Record<string, string[]> = {
  principal_reviewer: [...PRINCIPAL_REVIEWER_SKILLS],
  architect: [
    'System Design',
    'API Design',
    'Database Design',
    'PostgreSQL',
    'NestJS',
    'Node.js',
    'Backend',
    'Security',
    'Microservices',
    'Scalability',
  ],
  ui_ux: [
    'Figma',
    'Design Systems',
    'User Flows',
    'Wireframing',
    'Prototyping',
    'UI Design',
    'UX Research',
    'Accessibility',
    'Ecommerce UX',
    'Responsive Design',
  ],
  implementation: [
    'Frontend',
    'Backend',
    'Full Stack',
    'API Development',
    'Database Design',
    'Testing',
  ],
};
const MATCH_START_ALLOWED_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.BRIEF_COMPLETE,
  ProjectStatus.WAITING_FOR_PR,
  ProjectStatus.PLANNING_MATCHING,
]);
const ASSIGNMENT_ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress'];
export const ROLE_FILLED_STATUSES = [
  ...ASSIGNMENT_ACTIVE_STATUSES,
  'completed',
];

// --- Implementation-task matching -------------------------------------------

// A task can only be matched from these statuses (per the delivery contract).
const MATCHABLE_TASK_STATUSES = ['todo', 'blocked', 'changes_requested'];

// Tasks still counted as "someone's open work" for the workload signal.
const ACTIVE_TASK_STATUSES = [
  'todo',
  'blocked',
  'in_progress',
  'review',
  'changes_requested',
];
export const MAX_ACTIVE_TASKS_PER_FREELANCER = 3;

export function hasTaskCapacity(
  activeTaskCount: number,
  activeInvitationCount: number,
): boolean {
  return (
    activeTaskCount + activeInvitationCount < MAX_ACTIVE_TASKS_PER_FREELANCER
  );
}

const IMPLEMENTATION_MATCH_ALLOWED_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.IMPLEMENTATION_READY,
  ProjectStatus.MATCHING,
  ProjectStatus.MATCHED,
  ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING,
  ProjectStatus.ASSIGNED,
  ProjectStatus.ACTIVE,
  ProjectStatus.UNDER_REVIEW,
]);

const ASSIGNABLE_CANDIDATE_STATUSES = new Set([
  'recommended',
  'shortlisted',
  'selected',
  'invited',
]);

export function assertTaskMatchingRunInvariant(
  run: Pick<
    MatchingRun,
    'targetType' | 'targetTaskId' | 'projectId' | 'status'
  >,
  task: Pick<ProjectTask, 'id' | 'projectId'>,
) {
  if (
    run.targetType !== 'task' ||
    run.targetTaskId !== task.id ||
    run.projectId !== task.projectId
  ) {
    throw new BadRequestException(
      'The matching run does not belong to this project task',
    );
  }
  if (!['completed', 'reviewed'].includes(run.status)) {
    throw new ConflictException(
      'The matching run must complete before a task can be assigned',
    );
  }
}

export function requiresReviewerCandidateSelection(
  targetRoleKey: string | null,
) {
  return targetRoleKey !== PRINCIPAL_REVIEWER_ROLE;
}

export function completedEmptyRunIsCoolingDown(
  status: string,
  candidateCount: number,
  createdAt: Date,
  now = Date.now(),
  retryMs = EMPTY_RUN_RETRY_MS,
) {
  return (
    status === 'completed' &&
    candidateCount === 0 &&
    createdAt.getTime() > now - retryMs
  );
}

export function staffingFailureIsCoolingDown(
  automationStatus: string | null | undefined,
  automationErrorAt: Date | null | undefined,
  now = Date.now(),
  retryMs = EMPTY_RUN_RETRY_MS,
) {
  return (
    automationStatus === 'staffing_blocked' &&
    automationErrorAt instanceof Date &&
    automationErrorAt.getTime() > now - retryMs
  );
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectRepository(MatchingRun)
    private readonly runRepo: Repository<MatchingRun>,
    @InjectRepository(MatchingCandidate)
    private readonly candidateRepo: Repository<MatchingCandidate>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(ProjectTask)
    private readonly taskRepo: Repository<ProjectTask>,
    @InjectRepository(ProjectInvitation)
    private readonly invitationRepo: Repository<ProjectInvitation>,
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
    private readonly repositoriesService: RepositoriesService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly incidents?: AutomationIncidentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Start planning-role matching
  // ---------------------------------------------------------------------------

  // Automatically triggered when a project's brief becomes complete. No-ops if
  // matching already ran or the project is not startable, and never throws — it
  // must not disrupt the brief-completion flow that calls it.
  async autoStartPlanningRoles(projectId: string): Promise<boolean> {
    try {
      const reviewer = await this.dataSource
        .getRepository(ProjectRoleAssignment)
        .findOne({
          where: {
            projectId,
            phase: 'governance',
            roleKey: PRINCIPAL_REVIEWER_ROLE,
            status: In(['accepted', 'in_progress']),
          },
        });
      if (!reviewer) return false;
      const project = await this.projectRepo.findOne({
        where: { id: projectId },
      });
      if (!project || !MATCH_START_ALLOWED_STATUSES.has(project.status)) {
        return false;
      }
      const requiredRoles = requiredPreFundingRoles();
      const existingRuns = await this.runRepo.find({
        where: {
          projectId,
          targetType: 'planning_role',
          targetRoleKey: In(requiredRoles),
          status: In(['queued', 'running', 'completed', 'reviewed']),
        },
        select: {
          id: true,
          targetRoleKey: true,
          status: true,
          createdAt: true,
        },
      });
      const candidateCounts = await this.getCandidateCounts(
        existingRuns.map((run) => run.id),
      );
      const startedRoles = new Set(
        existingRuns
          .filter(
            (run) =>
              run.status !== 'completed' ||
              (candidateCounts.get(run.id) ?? 0) > 0 ||
              completedEmptyRunIsCoolingDown(
                run.status,
                candidateCounts.get(run.id) ?? 0,
                run.createdAt,
              ),
          )
          .map((run) => run.targetRoleKey)
          .filter((role): role is string => Boolean(role)),
      );
      const missingRoles = requiredRoles.filter(
        (role) => !startedRoles.has(role),
      );
      if (!missingRoles.length) return false;
      if (
        staffingFailureIsCoolingDown(
          project.automationStatus,
          project.automationErrorAt,
        )
      ) {
        return false;
      }

      await this.startPlanningRoles(projectId, { roles: missingRoles }, null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auto-start matching failed for project ${projectId}: ${message}`,
      );
      await this.markStaffingBlocked(projectId, message);
      return false;
    }
  }

  async autoStartPrincipalReviewer(projectId: string): Promise<boolean> {
    try {
      const existingAssignment = await this.dataSource
        .getRepository(ProjectRoleAssignment)
        .findOne({
          where: {
            projectId,
            phase: 'governance',
            roleKey: PRINCIPAL_REVIEWER_ROLE,
            status: In(['assigned', 'accepted', 'in_progress']),
          },
        });
      if (existingAssignment) return false;
      const pendingInvitation = await this.invitationRepo.findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['pending', 'accepting']),
        },
      });
      if (pendingInvitation) return false;
      const latestRun = await this.runRepo.findOne({
        where: {
          projectId,
          targetType: 'planning_role',
          targetRoleKey: PRINCIPAL_REVIEWER_ROLE,
        },
        order: { createdAt: 'DESC' },
      });
      if (latestRun && ['queued', 'running'].includes(latestRun.status)) {
        return false;
      }
      if (latestRun?.status === 'completed') {
        const [count, fallbackCount] = await Promise.all([
          this.candidateRepo.count({
            where: { matchingRunId: latestRun.id },
          }),
          this.candidateRepo.count({
            where: {
              matchingRunId: latestRun.id,
              status: In(['recommended', 'shortlisted', 'selected']),
            },
          }),
        ]);
        // A process can stop after committing the ranked candidates but before
        // persisting the invitation. Recover that exact run instead of treating
        // its candidate rows as proof that staffing already progressed.
        if (fallbackCount > 0) {
          const invitation = await this.inviteNextCandidate(latestRun.id);
          if (invitation) return true;
        }
        if (
          completedEmptyRunIsCoolingDown(
            latestRun.status,
            count,
            latestRun.createdAt,
          )
        ) {
          return false;
        }
      }
      const project = await this.getProject(projectId);
      if (!MATCH_START_ALLOWED_STATUSES.has(project.status)) return false;
      await this.startPlanningRoles(
        projectId,
        { roles: [PRINCIPAL_REVIEWER_ROLE] },
        null,
      );
      return true;
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(
        `Principal-reviewer automation failed for ${projectId}: ${message}`,
      );
      if (error instanceof ConflictException) {
        await this.markWaitingForPrincipalReviewer(projectId, message);
      } else {
        await this.markStaffingBlocked(projectId, message);
      }
      return false;
    }
  }

  async recoverProjectsAwaitingPrincipalReviewer() {
    const projects = await this.projectRepo.find({
      where: [
        {
          status: ProjectStatus.BRIEF_COMPLETE,
          automationStatus: 'awaiting_principal_reviewer',
        },
        { status: ProjectStatus.WAITING_FOR_PR },
      ],
      order: { updatedAt: 'ASC' },
      take: 25,
    });
    let restarted = 0;
    for (const project of projects) {
      if (await this.autoStartPrincipalReviewer(project.id)) restarted += 1;
    }
    return { inspected: projects.length, restarted };
  }

  async assertProjectReadyForFunding(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const capacityExpiresAt = Date.parse(
      typeof project.implementationCapacitySnapshot?.expiresAt === 'string'
        ? project.implementationCapacitySnapshot.expiresAt
        : '',
    );
    if (
      !Number.isFinite(capacityExpiresAt) ||
      capacityExpiresAt <= Date.now()
    ) {
      const refreshedCapacity =
        await this.estimateImplementationCapacity(project);
      project.implementationCapacitySnapshot = refreshedCapacity;
      if (refreshedCapacity.status === 'unavailable') {
        project.automationStatus = 'ready_for_funding_capacity_at_risk';
        project.automationError = refreshedCapacity.blockingReasons.join(' ');
        project.automationErrorCategory = 'implementation_capacity';
        project.automationErrorAt = new Date();
      } else {
        project.automationStatus = 'ready_for_funding';
        project.automationError = null;
        project.automationErrorCategory = null;
        project.automationErrorAt = null;
      }
      await this.projectRepo
        .createQueryBuilder()
        .update(Project)
        .set({
          implementationCapacitySnapshot: () =>
            'CAST(:implementationCapacitySnapshot AS jsonb)',
          automationStatus: project.automationStatus,
          automationError: project.automationError,
          automationErrorCategory: project.automationErrorCategory,
          automationErrorAt: project.automationErrorAt,
        })
        .where('id = :projectId', { projectId: project.id })
        .setParameter(
          'implementationCapacitySnapshot',
          JSON.stringify(project.implementationCapacitySnapshot),
        )
        .execute();
    }
    const [reviewer, planningRoles, pendingInvitations] = await Promise.all([
      this.dataSource.getRepository(ProjectRoleAssignment).findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['accepted', 'in_progress']),
        },
      }),
      this.dataSource.getRepository(ProjectRoleAssignment).find({
        where: {
          projectId,
          phase: In(['planning', 'staffing']),
          status: In(['accepted', 'in_progress']),
        },
      }),
      this.invitationRepo.count({
        where: { projectId, status: In(['pending', 'accepting']) },
      }),
    ]);
    const roles = new Set(
      planningRoles.map((assignment) => assignment.roleKey),
    );
    const missing = requiredPreFundingRoles().filter(
      (role) => !roles.has(role),
    );
    const capacityStatus =
      typeof project.implementationCapacitySnapshot?.status === 'string'
        ? project.implementationCapacitySnapshot.status
        : null;
    if (
      project.status !== ProjectStatus.READY_FOR_FUNDING ||
      !reviewer ||
      missing.length > 0 ||
      pendingInvitations > 0 ||
      capacityStatus === 'unavailable'
    ) {
      const details = [
        !reviewer ? 'principal reviewer not accepted' : null,
        missing.length ? `missing accepted roles: ${missing.join(', ')}` : null,
        pendingInvitations
          ? `${pendingInvitations} invitation(s) still pending`
          : null,
        capacityStatus === 'unavailable'
          ? 'the latest implementation-capacity sweep found too few available freelancers'
          : null,
      ].filter(Boolean);
      throw new ConflictException(
        `Planning funding is locked until the reviewer and planning team have accepted and the implementation-capacity sweep finds enough available freelancers${details.length ? ` (${details.join('; ')})` : ''}.`,
      );
    }
    return project;
  }

  async activateFundedProject(projectId: string) {
    const project = await this.dataSource.transaction(async (manager) => {
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      const funding = projectFundingBreakdown(project.budgetAllocation);
      const held = Number(project.heldAmount);
      const planningAmount = Number(funding?.planningAmount);
      if (
        !funding ||
        !Number.isFinite(planningAmount) ||
        planningAmount <= 0 ||
        held + 0.005 < planningAmount
      ) {
        throw new ConflictException(
          'The planning package is not held in escrow yet',
        );
      }
      if (project.status === ProjectStatus.PLANNING_ASSIGNED) {
        if (!project.planningFundedAt) {
          project.planningFundedAt = new Date();
          await manager.save(Project, project);
        }
        return project;
      }
      if (project.status !== ProjectStatus.READY_FOR_FUNDING) {
        throw new ConflictException(
          'The accepted team is no longer ready to start',
        );
      }
      await this.transitionProject(manager, project, null, {
        status: ProjectStatus.PLANNING_ASSIGNED,
        planningStatus: 'assigned',
        reason:
          'Planning escrow funded after the reviewer, architect, and UI/UX designer accepted.',
        setAssignedAt: true,
      });
      project.planningFundedAt = project.planningFundedAt ?? new Date();
      project.automationStatus = 'planning_team_active';
      await manager.save(Project, project);
      return project;
    });
    await this.repositoriesService
      .provisionForAssignedTeam(projectId)
      .catch((error: unknown) =>
        this.logger.error(
          `Automatic repository access failed after planning funding for project ${projectId}: ${this.errorMessage(error)}`,
        ),
      );
    return project;
  }

  async activateImplementation(projectId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      if (
        this.isProjectFullyFunded(project) &&
        [ProjectStatus.ASSIGNED, ProjectStatus.ACTIVE].includes(project.status)
      ) {
        if (!project.implementationFundedAt) {
          project.implementationFundedAt = new Date();
          await manager.save(Project, project);
        }
        return { project, activatedTaskIds: [] as string[] };
      }
      if (project.status !== ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING) {
        throw new ConflictException(
          'Implementation funding unlocks only after every Scrum task has an accepted freelancer',
        );
      }
      if (!this.isProjectFullyFunded(project)) {
        throw new ConflictException(
          'The complete implementation balance is not held in escrow yet',
        );
      }

      const tasks = await manager.find(ProjectTask, {
        where: {
          projectId,
          status: Not('cancelled'),
        },
        order: { orderIndex: 'ASC' },
      });
      if (
        !tasks.length ||
        tasks.some((task) => !task.assignedFreelancerProfileId)
      ) {
        throw new ConflictException(
          'Every implementation task must keep an accepted freelancer until funding completes',
        );
      }

      const now = new Date();
      const datedTasks = tasks.filter((task) => task.startsAt && task.dueAt);
      const earliestStart = datedTasks.reduce<Date | null>(
        (earliest, task) =>
          !earliest || task.startsAt! < earliest ? task.startsAt! : earliest,
        null,
      );
      const scheduleShiftMs = earliestStart
        ? Math.max(0, now.getTime() - earliestStart.getTime())
        : 0;
      const activatedTaskIds: string[] = [];
      for (const task of tasks) {
        if (task.assignmentStatus !== 'reserved') continue;
        const priorStart = task.startsAt;
        const priorDue = task.dueAt;
        if (scheduleShiftMs > 0) {
          if (priorStart) {
            task.startsAt = new Date(priorStart.getTime() + scheduleShiftMs);
          }
          if (priorDue) {
            task.dueAt = new Date(priorDue.getTime() + scheduleShiftMs);
          }
        }
        task.assignedAt = now;
        task.assignmentStatus = 'accepted';
        task.metadata = {
          ...(task.metadata ?? {}),
          fundingActivatedAt: now.toISOString(),
          workStartsAfterImplementationFunding: false,
          scheduleFundingShiftMs: scheduleShiftMs,
          reservedAt: task.metadata?.reservedAt ?? null,
        };
        activatedTaskIds.push(task.id);
      }
      if (activatedTaskIds.length) {
        await manager.save(ProjectTask, tasks);
      }
      if (scheduleShiftMs > 0 && activatedTaskIds.length) {
        const checkpoints = await manager.find(TaskCheckpoint, {
          where: {
            taskId: In(activatedTaskIds),
            status: In(['pending', 'deferred']),
          },
        });
        for (const checkpoint of checkpoints) {
          checkpoint.dueAt = new Date(
            checkpoint.dueAt.getTime() + scheduleShiftMs,
          );
          checkpoint.status = 'pending';
          checkpoint.assessedAt = null;
        }
        if (checkpoints.length) await manager.save(TaskCheckpoint, checkpoints);
      }

      await this.transitionProject(manager, project, null, {
        status: ProjectStatus.ASSIGNED,
        reason:
          'Implementation escrow funded; reserved assignments and deadline counters activated together.',
        setAssignedAt: true,
      });
      project.implementationFundedAt = now;
      project.automationStatus = 'implementation_active';
      project.automationError = null;
      project.automationErrorCategory = null;
      project.automationErrorAt = null;
      await manager.save(Project, project);
      return { project, activatedTaskIds };
    });

    await this.repositoriesService
      .provisionForAssignedTeam(projectId)
      .catch((error: unknown) =>
        this.logger.error(
          `Automatic repository access failed after implementation funding for project ${projectId}: ${this.errorMessage(error)}`,
        ),
      );
    if (result.activatedTaskIds.length) {
      const assignees = await this.taskRepo.find({
        where: { id: In(result.activatedTaskIds) },
        relations: ['assignedFreelancerProfile'],
      });
      const notified = new Set<string>();
      for (const task of assignees) {
        const userId = task.assignedFreelancerProfile?.userId;
        if (!userId || notified.has(userId)) continue;
        notified.add(userId);
        await this.notificationsService.createNotification({
          userId,
          projectId,
          type: 'implementation_funded',
          title: 'Implementation work is funded',
          body: 'The customer funded implementation escrow. Your accepted task schedule and deadline counters are now active.',
          actionUrl: `/freelancer/projects/${projectId}`,
        });
      }
    }
    return result.project;
  }

  async reconcileProjectFundingReadiness(projectId: string) {
    const transitioned = await this.dataSource.transaction(async (manager) =>
      this.maybeAdvanceToPlanningAssigned(manager, projectId, null),
    );
    if (!transitioned) {
      await this.publishImplementationCapacityBlockIfNeeded(projectId);
      return false;
    }
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) return true;
    const capacityAtRisk =
      project.implementationCapacitySnapshot?.status === 'unavailable';
    await this.notifyProjectOwner(
      project,
      'Your project team is ready',
      capacityAtRisk
        ? 'Your principal reviewer, architect, and UI/UX designer have accepted. The latest capacity sweep found too few available implementation freelancers, so planning payment remains locked. Nexus AI will keep checking and email you with a payment link as soon as enough freelancers are available.'
        : 'Your principal reviewer, architect, and UI/UX designer have accepted. Fund the planning package to begin architecture and design; implementation is charged only after the exact Scrum tasks are staffed.',
      undefined,
      {
        customerActionUrl: `/projects/${project.id}/payments`,
        customerType: capacityAtRisk
          ? 'implementation_capacity_update'
          : 'staffing_update',
      },
    );
    await this.projectRepo.update(
      {
        id: project.id,
        automationStatus: In([
          'ready_for_funding',
          'ready_for_funding_capacity_at_risk',
        ]),
      },
      {
        automationStatus: capacityAtRisk
          ? 'ready_for_funding_capacity_at_risk_notified'
          : 'ready_for_funding_notified',
      },
    );
    return true;
  }

  async recoverReadyForFundingNotifications() {
    const projects = await this.projectRepo.find({
      where: {
        status: ProjectStatus.READY_FOR_FUNDING,
        automationStatus: In([
          'ready_for_funding',
          'ready_for_funding_capacity_at_risk',
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: 25,
    });
    let notified = 0;
    for (const project of projects) {
      const capacityAtRisk =
        project.implementationCapacitySnapshot?.status === 'unavailable';
      await this.notifyProjectOwner(
        project,
        'Your project team is ready',
        capacityAtRisk
          ? 'Your principal reviewer, architect, and UI/UX designer have accepted. The latest capacity sweep found too few available implementation freelancers, so planning payment remains locked. Nexus AI will keep checking and email you with a payment link as soon as enough freelancers are available.'
          : 'Your principal reviewer, architect, and UI/UX designer have accepted. Fund the planning package to begin architecture and design; implementation is charged only after the exact Scrum tasks are staffed.',
        undefined,
        {
          customerActionUrl: `/projects/${project.id}/payments`,
          customerType: capacityAtRisk
            ? 'implementation_capacity_update'
            : 'staffing_update',
        },
      );
      await this.projectRepo.update(
        {
          id: project.id,
          automationStatus: In([
            'ready_for_funding',
            'ready_for_funding_capacity_at_risk',
          ]),
        },
        {
          automationStatus: capacityAtRisk
            ? 'ready_for_funding_capacity_at_risk_notified'
            : 'ready_for_funding_notified',
        },
      );
      notified += 1;
    }
    return { inspected: projects.length, notified };
  }

  async recoverPlanningFundingReadiness() {
    const projects = await this.projectRepo.find({
      where: {
        status: In([
          ProjectStatus.BRIEF_COMPLETE,
          ProjectStatus.WAITING_FOR_PR,
          ProjectStatus.PLANNING_MATCHING,
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: 25,
    });
    let unlocked = 0;
    for (const project of projects) {
      try {
        if (await this.reconcileProjectFundingReadiness(project.id)) {
          unlocked += 1;
        }
      } catch (error) {
        this.logger.error(
          `Planning funding readiness recovery failed for ${project.id}: ${this.errorMessage(error)}`,
        );
      }
    }
    return { inspected: projects.length, unlocked };
  }

  async refreshUnavailableImplementationCapacity() {
    const projects = await this.projectRepo.find({
      where: {
        status: ProjectStatus.READY_FOR_FUNDING,
        automationStatus: In([
          'ready_for_funding_capacity_at_risk',
          'ready_for_funding_capacity_at_risk_notified',
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: 25,
    });
    let refreshed = 0;
    let available = 0;
    for (const project of projects) {
      const checkedAt = Date.parse(
        typeof project.implementationCapacitySnapshot?.checkedAt === 'string'
          ? project.implementationCapacitySnapshot.checkedAt
          : '',
      );
      if (Number.isFinite(checkedAt) && checkedAt > Date.now() - 15 * 60_000) {
        continue;
      }
      try {
        const capacity = await this.estimateImplementationCapacity(project);
        const isNowAvailable = capacity.status !== 'unavailable';
        const nextAutomationStatus = isNowAvailable
          ? 'ready_for_funding_capacity_available'
          : project.automationStatus;
        const result = await this.projectRepo
          .createQueryBuilder()
          .update(Project)
          .set({
            implementationCapacitySnapshot: () =>
              'CAST(:implementationCapacitySnapshot AS jsonb)',
            automationStatus: nextAutomationStatus,
            automationError: isNowAvailable
              ? null
              : capacity.blockingReasons.join(' '),
            automationErrorCategory: isNowAvailable
              ? null
              : 'implementation_capacity',
            automationErrorAt: isNowAvailable ? null : new Date(),
          })
          .where('id = :projectId', { projectId: project.id })
          .andWhere('automation_status IN (:...automationStatuses)', {
            automationStatuses: [
              'ready_for_funding_capacity_at_risk',
              'ready_for_funding_capacity_at_risk_notified',
            ],
          })
          .setParameter(
            'implementationCapacitySnapshot',
            JSON.stringify(capacity),
          )
          .execute();
        if (!result.affected) continue;
        refreshed += 1;
        if (!isNowAvailable) continue;
        available += 1;
        project.implementationCapacitySnapshot = capacity;
        await this.notifyProjectOwner(
          project,
          'Capacity is available and planning is ready to fund',
          `The latest capacity check found ${capacity.workableCandidates} workable implementation freelancer(s) for the estimated ${capacity.requiredPeople}-person team. Open the payment page to fund planning. Exact freelancers will still accept the generated Scrum tasks before implementation funding is enabled.`,
          undefined,
          {
            customerActionUrl: `/projects/${project.id}/payments`,
            customerType: 'implementation_capacity_update',
          },
        );
        await this.projectRepo.update(
          {
            id: project.id,
            automationStatus: 'ready_for_funding_capacity_available',
          },
          { automationStatus: 'ready_for_funding_capacity_available_notified' },
        );
      } catch (error) {
        this.logger.error(
          `Implementation capacity refresh failed for ${project.id}: ${this.errorMessage(error)}`,
        );
      }
    }
    return { inspected: projects.length, refreshed, available };
  }

  /**
   * Stripe capture and workflow activation are deliberately separate: the
   * payment hold is committed first, then the team is activated. If the
   * process stops between those operations, this reconciler finishes the
   * correct stage without charging again or requiring an admin retry.
   */
  async recoverFundedStageActivations() {
    const projects = await this.projectRepo.find({
      where: {
        status: In([
          ProjectStatus.READY_FOR_FUNDING,
          ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING,
        ]),
      },
      order: { updatedAt: 'ASC' },
      take: 25,
    });
    let planningActivated = 0;
    let implementationActivated = 0;
    for (const project of projects) {
      try {
        if (project.status === ProjectStatus.READY_FOR_FUNDING) {
          const planningAmount = Number(
            projectFundingBreakdown(project.budgetAllocation)?.planningAmount,
          );
          if (
            Number.isFinite(planningAmount) &&
            Number(project.heldAmount) + 0.005 >= planningAmount
          ) {
            await this.activateFundedProject(project.id);
            planningActivated += 1;
          }
          continue;
        }
        if (this.isProjectFullyFunded(project)) {
          await this.activateImplementation(project.id);
          implementationActivated += 1;
        }
      } catch (error) {
        this.logger.error(
          `Funded-stage activation recovery failed for ${project.id}: ${this.errorMessage(error)}`,
        );
        await this.incidents?.record({
          subsystem: 'matching',
          operation: 'activate_funded_stage',
          projectId: project.id,
          errorCode: 'activation_failed',
          severity: 'critical',
          message: this.errorMessage(error),
          trace: error instanceof Error ? error.stack : undefined,
          context: {
            projectStatus: project.status,
            heldAmount: project.heldAmount,
            quotedAmount: project.quotedAmount,
            recommendedChecks: [
              'Verify the Stripe hold and project held amount agree.',
              'Verify accepted assignments still exist for the current funding stage.',
              'Retry activation after correcting the blocking invariant.',
            ],
          },
        });
      }
    }
    return {
      inspected: projects.length,
      planningActivated,
      implementationActivated,
    };
  }

  async startPlanningRoles(
    projectId: string,
    dto: StartPlanningMatchingDto,
    adminUserId: string | null,
  ) {
    const project = await this.getProject(projectId);
    if (!MATCH_START_ALLOWED_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'Planning matching can only start after the brief is complete',
      );
    }
    this.assertProjectReadyForStaffing(project);

    const roles = dto.roles?.length
      ? Array.from(new Set(dto.roles))
      : [...PLANNING_ROLES];
    const unsupported = roles.filter(
      (role) =>
        role !== PRINCIPAL_REVIEWER_ROLE && !PLANNING_ROLES.includes(role),
    );
    if (unsupported.length) {
      throw new BadRequestException(
        `Implementation freelancers are matched from approved Scrum tasks, not generic pre-planning roles: ${unsupported.join(', ')}`,
      );
    }
    if (roles.some(requiresReviewerCandidateSelection)) {
      await this.assertPrincipalReviewerAssigned(projectId);
    }

    const brief = await this.briefRepo.findOne({ where: { projectId } });
    const candidatePools = new Map(
      await Promise.all(
        roles.map(
          async (role) =>
            [
              role,
              (await this.buildCandidatePool(dto, brief, project, role))
                .candidates,
            ] as const,
        ),
      ),
    );
    const limit = dto.filters?.limit ?? DEFAULT_LIMIT;

    // Create the runs and flip the project up front, in a short transaction, so
    // the (potentially slow) AI calls do not hold a DB transaction open.
    const runs = await this.dataSource.transaction(async (manager) => {
      const lockedProject = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOne();
      if (!lockedProject) throw new NotFoundException('Project not found');
      if (!MATCH_START_ALLOWED_STATUSES.has(lockedProject.status)) return [];
      const created: MatchingRun[] = [];
      for (const role of roles) {
        const alreadyRunning = await manager.exists(MatchingRun, {
          where: {
            projectId,
            targetType: 'planning_role',
            targetRoleKey: role,
            status: In(['queued', 'running']),
          },
        });
        if (alreadyRunning) continue;
        created.push(
          await manager.save(
            MatchingRun,
            manager.create(MatchingRun, {
              projectId,
              targetType: 'planning_role',
              targetRoleKey: role,
              status: 'running',
              requestedBy: adminUserId,
              filters: dto.filters ? { ...dto.filters } : null,
              inputSnapshot: {
                candidatePoolSize: candidatePools.get(role)?.length ?? 0,
                filters: dto.filters ?? null,
              },
              startedAt: new Date(),
            }),
          ),
        );
      }
      if (created.length) {
        await this.transitionProject(manager, lockedProject, adminUserId, {
          status: ProjectStatus.PLANNING_MATCHING,
          planningStatus: 'matching',
          reason: 'Started planning-role matching.',
          setPlanningStartedAt: true,
        });
      }
      return created;
    });

    const briefSnapshot = this.buildBriefSnapshot(brief);
    const runResults: Record<string, unknown>[] = [];

    for (const run of runs) {
      try {
        const candidates = candidatePools.get(run.targetRoleKey!) ?? [];
        // Rank against role-specific skills (admin override, else per-role default).
        const roleSkills = dto.filters?.skills?.length
          ? dto.filters.skills
          : (PLANNING_ROLE_SKILLS[staffingRoleBase(run.targetRoleKey!)] ?? []);
        const ai = await this.aiService.matchFreelancers({
          matchingRunId: run.id,
          targetType: 'planning_role',
          targetRoleKey: run.targetRoleKey!,
          limit,
          project: this.buildProjectSnapshot(project, roleSkills),
          brief: briefSnapshot,
          candidates,
        });

        const candidateCount = await this.completeRun(run, ai);
        const requiresReviewerSelection = requiresReviewerCandidateSelection(
          run.targetRoleKey,
        );
        const invitation = requiresReviewerSelection
          ? null
          : await this.inviteNextCandidate(run.id);
        runResults.push({
          id: run.id,
          targetType: 'planning_role',
          targetRoleKey: run.targetRoleKey,
          status: 'completed',
          candidateCount,
          summary: ai.summary,
          selectionRequired: requiresReviewerSelection,
          invitationId: invitation?.id ?? null,
        });
      } catch (error) {
        runResults.push({
          id: run.id,
          targetType: 'planning_role',
          targetRoleKey: run.targetRoleKey,
          status: 'failed',
          candidateCount: 0,
          error: await this.failRun(run, error),
        });
      }
    }

    const staffingFailed = runResults.some(
      (result) =>
        result.status === 'failed' ||
        Number(result.candidateCount ?? 0) === 0 ||
        (result.targetRoleKey === PRINCIPAL_REVIEWER_ROLE &&
          result.invitationId == null),
    );
    if (staffingFailed) {
      const failureReason = runResults
        .filter(
          (result) =>
            result.status === 'failed' ||
            Number(result.candidateCount ?? 0) === 0 ||
            (result.targetRoleKey === PRINCIPAL_REVIEWER_ROLE &&
              result.invitationId == null),
        )
        .map((result) => {
          const roleKey =
            typeof result.targetRoleKey === 'string'
              ? result.targetRoleKey
              : 'planning role';
          return typeof result.error === 'string' && result.error
            ? `${roleKey}: ${result.error}`
            : `No eligible candidate was found for ${roleKey}.`;
        })
        .join(' ');
      if (
        runResults.some(
          (result) =>
            result.targetRoleKey === PRINCIPAL_REVIEWER_ROLE &&
            (result.status === 'failed' ||
              Number(result.candidateCount ?? 0) === 0 ||
              result.invitationId == null),
        )
      ) {
        await this.markWaitingForPrincipalReviewer(
          projectId,
          failureReason || 'No principal reviewer currently has capacity.',
        );
      } else {
        await this.markStaffingBlocked(
          projectId,
          failureReason ||
            'One or more planning roles could not produce an eligible shortlist.',
        );
      }
    } else if (runResults.some((result) => result.selectionRequired === true)) {
      await this.markAwaitingReviewerSelection(
        project,
        runResults.filter((result) => result.selectionRequired === true),
      );
    } else {
      await this.incidents?.resolveOperation(
        'matching',
        'staff_project',
        projectId,
      );
    }

    return {
      projectId,
      projectStatus: ProjectStatus.PLANNING_MATCHING,
      planningStatus: 'matching',
      runs: runResults,
    };
  }

  // Store the ranked candidates and mark the run completed.
  private async completeRun(run: MatchingRun, ai: MatchFreelancersResult) {
    return this.dataSource.transaction(async (manager) => {
      const rows = ai.candidates.map((candidate) =>
        manager.create(MatchingCandidate, {
          matchingRunId: run.id,
          freelancerProfileId: candidate.freelancerProfileId,
          rank: candidate.rank,
          score: candidate.score.toFixed(2),
          scoreBreakdown: candidate.scoreBreakdown,
          rationale: candidate.rationale,
          evidence: candidate.evidence,
          status: 'recommended',
        }),
      );
      if (rows.length) {
        await manager.save(MatchingCandidate, rows);
      }
      run.status = 'completed';
      run.completedAt = new Date();
      run.summary = ai.summary;
      await manager.save(MatchingRun, run);
      return rows.length;
    });
  }

  // Persist the failure on the run so the admin UI can show and retry it.
  private async failRun(run: MatchingRun, error: unknown) {
    const message = this.errorMessage(error);
    this.logger.error(`Matching run ${run.id} failed: ${message}`);
    run.status = 'failed';
    run.error = message;
    await this.runRepo.save(run);
    return message;
  }

  // ---------------------------------------------------------------------------
  // Start implementation-task matching
  // ---------------------------------------------------------------------------

  async autoStartImplementationTasks(
    projectId: string,
    adminUserId: string | null,
  ) {
    try {
      const result = await this.startImplementationTasks(
        projectId,
        // Matching is deterministic and normally fast. Waiting here guarantees
        // that a process restart cannot strand the automatically-created runs.
        { mode: 'sync' },
        adminUserId,
      );
      return {
        triggered: true,
        ...result,
      };
    } catch (error) {
      const message = this.errorMessage(error);
      if (
        error instanceof BadRequestException &&
        message.includes('No unassigned implementation tasks')
      ) {
        return {
          triggered: false,
          projectId,
          reason: 'no_unmatched_tasks',
        };
      }
      const existingRunCount = await this.runRepo.count({
        where: {
          projectId,
          targetType: 'task',
          status: In(['queued', 'running', 'completed', 'reviewed']),
        },
      });
      if (existingRunCount > 0) {
        return {
          triggered: false,
          projectId,
          reason: 'matching_already_started',
          runCount: existingRunCount,
        };
      }
      this.logger.error(
        `Automatic implementation matching failed for project ${projectId}: ${message}`,
      );
      await this.markStaffingBlocked(projectId, message);
      return {
        triggered: false,
        projectId,
        reason: 'matching_start_failed',
        error: message,
      };
    }
  }

  // One matching run per implementation task. Runs are created up front so the
  // admin sees them immediately; the AI ranking then fills each one in turn.
  async startImplementationTasks(
    projectId: string,
    dto: StartImplementationMatchingDto,
    adminUserId: string | null,
  ) {
    const project = await this.getProject(projectId);
    if (!IMPLEMENTATION_MATCH_ALLOWED_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'Implementation matching can only start once the project plan is materialized',
      );
    }
    this.assertPlanningFunded(project);
    await this.assertPrincipalReviewerAssigned(projectId);

    await this.recoverStaleImplementationRuns(projectId);
    const tasks = await this.resolveMatchableTasks(projectId, dto);
    if (!tasks.length) {
      throw new BadRequestException(
        'No unassigned implementation tasks are available to match',
      );
    }

    const brief = await this.briefRepo.findOne({ where: { projectId } });
    const briefSnapshot = this.buildBriefSnapshot(brief);
    const limit = dto.filters?.limit ?? DEFAULT_LIMIT;
    const explicitMaxRate = dto.filters?.maxHourlyRate ?? null;

    const runs = await this.dataSource.transaction(async (manager) => {
      const created: MatchingRun[] = [];
      for (const task of tasks) {
        const taskMaxRate = explicitMaxRate;
        created.push(
          await manager.save(
            MatchingRun,
            manager.create(MatchingRun, {
              projectId,
              targetType: 'task',
              targetRoleKey: task.roleKey,
              targetTaskId: task.id,
              status: 'running',
              requestedBy: adminUserId,
              filters: dto.filters ? { ...dto.filters } : null,
              inputSnapshot: {
                taskTitle: task.title,
                maxHourlyRate: taskMaxRate,
                filters: dto.filters ?? null,
              },
              startedAt: new Date(),
            }),
          ),
        );
      }
      if (project.status !== ProjectStatus.MATCHING) {
        await this.transitionProject(manager, project, adminUserId, {
          status: ProjectStatus.MATCHING,
          reason: 'Started implementation task matching.',
        });
      }
      return created;
    });

    const processRuns = () =>
      this.processImplementationRuns({
        project,
        briefSnapshot,
        limit,
        maxRate: explicitMaxRate,
        filters: dto.filters,
        tasks,
        runs,
      });

    if (dto.mode === 'async') {
      void processRuns().catch((error) => {
        this.logger.error(
          `Background implementation matching crashed for project ${projectId}: ${this.errorMessage(error)}`,
        );
      });
      return {
        projectId,
        projectStatus: ProjectStatus.MATCHING,
        processing: 'background',
        runs: runs.map((run) => ({
          id: run.id,
          targetType: 'task',
          targetTaskId: run.targetTaskId,
          targetRoleKey: run.targetRoleKey,
          status: 'running',
        })),
      };
    }

    const runResults = await processRuns();

    return {
      projectId,
      projectStatus: ProjectStatus.MATCHING,
      runs: runResults,
    };
  }

  private async processImplementationRuns(input: {
    project: Project;
    briefSnapshot: Record<string, unknown> | null;
    limit: number;
    maxRate: number | null;
    filters: PlanningMatchingFiltersDto | undefined;
    tasks: ProjectTask[];
    runs: MatchingRun[];
  }) {
    const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
    const runResults: Record<string, unknown>[] = [];

    for (const run of input.runs) {
      const task = tasksById.get(run.targetTaskId!);
      if (!task) {
        runResults.push({
          id: run.id,
          targetType: 'task',
          targetTaskId: run.targetTaskId,
          status: 'failed',
          error: await this.failRun(run, 'Materialized task was not found'),
        });
        continue;
      }
      try {
        const skills = input.filters?.skills?.length
          ? input.filters.skills
          : (task.requiredSkills ?? []);
        const candidates = await this.buildTaskCandidatePool(
          task,
          input.filters,
          input.maxRate,
        );
        const ai = await this.aiService.matchFreelancers({
          matchingRunId: run.id,
          targetType: 'task',
          targetRoleKey: run.targetRoleKey ?? 'implementation',
          targetTaskId: task.id,
          limit: input.limit,
          project: this.buildProjectSnapshot(input.project, skills),
          brief: input.briefSnapshot,
          task: this.buildTaskSnapshot(task, skills),
          candidates,
        });

        const candidateCount = await this.completeRun(run, ai);
        await this.taskRepo.update(task.id, {
          assignmentStatus: 'awaiting_reviewer_selection',
        });
        runResults.push({
          id: run.id,
          targetType: 'task',
          targetTaskId: task.id,
          targetRoleKey: run.targetRoleKey,
          taskTitle: task.title,
          status: 'completed',
          candidateCount,
          summary: ai.summary,
          selectionRequired: true,
          invitationId: null,
        });
      } catch (error) {
        runResults.push({
          id: run.id,
          targetType: 'task',
          targetTaskId: task.id,
          targetRoleKey: run.targetRoleKey,
          taskTitle: task.title,
          status: 'failed',
          candidateCount: 0,
          error: await this.failRun(run, error),
        });
      }
    }
    const staffingFailed = runResults.some(
      (result) =>
        result.status === 'failed' || Number(result.candidateCount ?? 0) === 0,
    );
    if (staffingFailed) {
      await this.markStaffingBlocked(
        input.project.id,
        'One or more implementation tasks could not produce an eligible shortlist.',
      );
    } else if (runResults.length > 0) {
      await this.markAwaitingReviewerSelection(input.project, runResults);
    } else {
      await this.incidents?.resolveOperation(
        'matching',
        'staff_project',
        input.project.id,
      );
    }
    return runResults;
  }

  // ---------------------------------------------------------------------------
  // Assign an implementation task
  // ---------------------------------------------------------------------------

  async assignTask(
    taskId: string,
    dto: AssignTaskDto,
    adminUserId: string | null,
  ) {
    if (!dto.candidateId && !dto.freelancerProfileId) {
      throw new BadRequestException(
        'candidateId or freelancerProfileId is required',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const taskReference = await manager.findOne(ProjectTask, {
        where: { id: taskId },
        select: { id: true, projectId: true },
      });
      if (!taskReference) throw new NotFoundException('Task not found');
      // Match invitation creation's project -> task lock order. It also makes
      // the final "all tasks assigned" count deterministic when several task
      // invitations are accepted at the same time.
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', {
          projectId: taskReference.projectId,
        })
        .getOne();
      if (!project) throw new NotFoundException('Project not found');
      const task = await manager
        .getRepository(ProjectTask)
        .createQueryBuilder('task')
        .setLock('pessimistic_write')
        .where('task.id = :taskId', { taskId })
        .getOne();
      if (!task) throw new NotFoundException('Task not found');
      if (task.assignedFreelancerProfileId) {
        throw new ConflictException(
          'This task already has an assigned freelancer',
        );
      }

      // A candidate carries its own freelancer and matching run, so it wins.
      let candidate: MatchingCandidate | null = null;
      if (dto.candidateId) {
        candidate = await manager.findOne(MatchingCandidate, {
          where: { id: dto.candidateId },
          relations: ['freelancerProfile', 'matchingRun'],
        });
        if (!candidate?.freelancerProfileId) {
          throw new NotFoundException('Matching candidate not found');
        }
        this.assertTaskMatchingRun(candidate.matchingRun, task);
        if (
          dto.sourceMatchingRunId &&
          dto.sourceMatchingRunId !== candidate.matchingRunId
        ) {
          throw new BadRequestException(
            'candidateId does not belong to sourceMatchingRunId',
          );
        }
        if (!ASSIGNABLE_CANDIDATE_STATUSES.has(candidate.status)) {
          throw new ConflictException(
            'This matching candidate is no longer available for assignment',
          );
        }
        if (
          dto.freelancerProfileId &&
          dto.freelancerProfileId !== candidate.freelancerProfileId
        ) {
          throw new BadRequestException(
            'candidateId and freelancerProfileId refer to different freelancers',
          );
        }
      }

      const freelancerProfileId =
        candidate?.freelancerProfileId ?? dto.freelancerProfileId!;
      // Invitation creation uses the same profile lock, so capacity cannot be
      // consumed concurrently between the check and this assignment.
      const profile = await manager
        .getRepository(FreelancerProfile)
        .createQueryBuilder('profile')
        .setLock('pessimistic_write')
        .where('profile.id = :profileId', { profileId: freelancerProfileId })
        .getOne();
      if (!profile) throw new NotFoundException('Freelancer profile not found');
      if (profile.verificationStatus !== 'approved') {
        throw new ConflictException(
          'Only an approved freelancer can be assigned to a task',
        );
      }
      if (!profile.isAvailable) {
        throw new ConflictException(
          'This freelancer is not currently available for assignment',
        );
      }

      const principalReviewerConflict = await manager.exists(
        ProjectRoleAssignment,
        {
          where: {
            projectId: task.projectId,
            freelancerProfileId,
            phase: 'governance',
            roleKey: PRINCIPAL_REVIEWER_ROLE,
            status: In(ASSIGNMENT_ACTIVE_STATUSES),
          },
        },
      );
      if (principalReviewerConflict) {
        throw new ConflictException(
          'A project principal reviewer cannot implement or review their own task work',
        );
      }
      const [activeTaskCount, activeInvitationCount] = await Promise.all([
        manager.count(ProjectTask, {
          where: {
            assignedFreelancerProfileId: freelancerProfileId,
            status: In(ACTIVE_TASK_STATUSES),
          },
        }),
        manager
          .getRepository(ProjectInvitation)
          .createQueryBuilder('invitation')
          .where('invitation.freelancerProfileId = :profileId', {
            profileId: freelancerProfileId,
          })
          .andWhere('invitation.taskId IS NOT NULL')
          .andWhere('invitation.taskId != :taskId', { taskId: task.id })
          .andWhere('invitation.status IN (:...statuses)', {
            statuses: ['pending', 'accepting'],
          })
          .getCount(),
      ]);
      if (!hasTaskCapacity(activeTaskCount, activeInvitationCount)) {
        throw new ConflictException(
          `A freelancer can hold at most ${MAX_ACTIVE_TASKS_PER_FREELANCER} active implementation tasks across projects`,
        );
      }
      this.assertTaskCompensationCoverage(task);

      let sourceRun: MatchingRun | null = candidate?.matchingRun ?? null;
      if (!candidate && dto.sourceMatchingRunId) {
        sourceRun = await manager.findOne(MatchingRun, {
          where: { id: dto.sourceMatchingRunId },
        });
        if (!sourceRun) {
          throw new NotFoundException('Source matching run not found');
        }
        this.assertTaskMatchingRun(sourceRun, task);

        candidate = await manager.findOne(MatchingCandidate, {
          where: {
            matchingRunId: sourceRun.id,
            freelancerProfileId,
          },
          relations: ['freelancerProfile', 'matchingRun'],
        });
        if (!candidate) {
          throw new BadRequestException(
            'The selected freelancer is not a candidate in the source matching run',
          );
        }
        if (!ASSIGNABLE_CANDIDATE_STATUSES.has(candidate.status)) {
          throw new ConflictException(
            'This matching candidate is no longer available for assignment',
          );
        }
      }

      const reservedAt = new Date();
      const implementationFunded = this.isProjectFullyFunded(project);
      const assignedAt = implementationFunded ? reservedAt : null;
      const scheduleOverrun = implementationFunded
        ? await this.rebaseTaskSchedule(manager, task, project, reservedAt)
        : false;
      task.assignedFreelancerProfileId = freelancerProfileId;
      task.sourceMatchingRunId = sourceRun?.id ?? null;
      task.sourceCandidateId = candidate?.id ?? null;
      task.assignedBy = adminUserId;
      task.assignedAt = assignedAt;
      // Freeze the contract rate at acceptance. Payouts must never read the
      // freelancer's mutable profile rate after work has been assigned.
      task.hourlyRateSnapshot = profile.hourlyRate;
      task.hourlyRateCurrencySnapshot = normalizeCurrency(
        profile.hourlyRateCurrency,
      );
      task.assignmentStatus = implementationFunded ? 'accepted' : 'reserved';
      if (task.status !== 'in_progress') task.status = 'todo';
      task.metadata = {
        ...(task.metadata ?? {}),
        ...(!implementationFunded
          ? {
              reservedAt: reservedAt.toISOString(),
              workStartsAfterImplementationFunding: true,
            }
          : {}),
        ...(dto.notes
          ? {
              assignmentNotes: dto.notes,
            }
          : {}),
      };
      await manager.save(ProjectTask, task);

      if (candidate) {
        candidate.status = 'assigned';
        candidate.selectedBy = adminUserId;
        candidate.selectedAt = candidate.selectedAt ?? new Date();
        await manager.save(MatchingCandidate, candidate);

        const run = await manager.findOne(MatchingRun, {
          where: { id: candidate.matchingRunId },
        });
        if (run) {
          run.status = 'reviewed';
          run.reviewedBy = adminUserId;
          run.reviewedAt = new Date();
          await manager.save(MatchingRun, run);
        }
      }

      const implementationFundingReady = await this.advanceImplementationStatus(
        manager,
        task.projectId,
        adminUserId,
      );

      return {
        task,
        notifyUserId: profile.userId ?? null,
        scheduleOverrun,
        implementationFunded,
        implementationFundingReady,
      };
    });

    if (result.notifyUserId) {
      await this.notificationsService.createNotification({
        userId: result.notifyUserId,
        projectId: result.task.projectId,
        taskId: result.task.id,
        type: 'task_assignment',
        title: result.implementationFunded
          ? 'New task assignment'
          : 'Task reservation accepted',
        body: result.implementationFunded
          ? `You were assigned the task "${result.task.title}". Its countdown starts from the accepted schedule.`
          : `Your place on "${result.task.title}" is reserved. Work and deadline countdowns start only after the customer funds the implementation escrow.`,
        actionUrl: `/freelancer/projects/${result.task.projectId}/tasks/${result.task.id}`,
      });
    }
    if (result.implementationFundingReady) {
      const readyProject = await this.projectRepo.findOne({
        where: { id: result.task.projectId },
      });
      if (readyProject) {
        await this.notifyImplementationFundingReady(readyProject);
      }
    }
    if (result.scheduleOverrun) {
      const reviewer = await this.dataSource
        .getRepository(ProjectRoleAssignment)
        .findOne({
          where: {
            projectId: result.task.projectId,
            phase: 'governance',
            roleKey: PRINCIPAL_REVIEWER_ROLE,
            status: In(['accepted', 'in_progress']),
          },
          relations: ['freelancerProfile'],
        });
      if (reviewer?.freelancerProfile?.userId) {
        await this.notificationsService.createNotification({
          userId: reviewer.freelancerProfile.userId,
          projectId: result.task.projectId,
          taskId: result.task.id,
          type: 'schedule_risk',
          title: 'Task schedule exceeds project deadline',
          body: `The rematched schedule for "${result.task.title}" now ends after the project deadline. Review dependencies and customer expectations.`,
          actionUrl: `/reviewer/projects/${result.task.projectId}`,
        });
      }
      // The customer is the one whose deadline this is, and previously only the
      // principal reviewer was told. Nothing here changes the deadline or blocks
      // the work — it just stops the customer being the last to know.
      // See ISSUES.md #26.
      const overrunProject = await this.dataSource
        .getRepository(Project)
        .findOne({ where: { id: result.task.projectId } });
      if (overrunProject?.customerId) {
        await this.notificationsService.createNotification({
          userId: overrunProject.customerId,
          projectId: result.task.projectId,
          taskId: result.task.id,
          type: 'schedule_risk',
          title: 'Your project may finish after its deadline',
          body: `Work on "${result.task.title}" was reassigned and the schedule now runs past your deadline${overrunProject.deadline ? ` of ${overrunProject.deadline.toISOString().slice(0, 10)}` : ''}. Your principal reviewer is reviewing the plan and will follow up.`,
          actionUrl: `/projects/${result.task.projectId}`,
        });
      }
    }
    if (result.implementationFunded) {
      await this.repositoriesService
        .provisionForAssignedTeam(result.task.projectId)
        .catch((error: unknown) =>
          this.logger.error(
            `Automatic repository access failed for task ${result.task.id}: ${this.errorMessage(error)}`,
          ),
        );
    }

    const { task } = result;
    return {
      id: task.id,
      projectId: task.projectId,
      milestoneId: task.milestoneId,
      status: task.status,
      assignedFreelancerProfileId: task.assignedFreelancerProfileId,
      sourceMatchingRunId: task.sourceMatchingRunId,
      sourceCandidateId: task.sourceCandidateId,
      assignedBy: task.assignedBy,
      assignedAt: task.assignedAt,
    };
  }

  // `assigned` once every open task has an owner, otherwise `matched` while
  // assignments are still being made.
  private async advanceImplementationStatus(
    manager: EntityManager,
    projectId: string,
    adminUserId: string | null,
  ) {
    const project = await manager.findOne(Project, {
      where: { id: projectId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!project) return false;

    const unassigned = await manager.count(ProjectTask, {
      where: {
        projectId,
        assignedFreelancerProfileId: IsNull(),
        status: Not(In(['done', 'cancelled'])),
      },
    });

    if (unassigned === 0) {
      const fullyFunded = this.isProjectFullyFunded(project);
      project.automationStatus = fullyFunded
        ? 'implementation_active'
        : 'implementation_team_ready_for_funding';
      project.automationError = null;
      project.automationErrorCategory = null;
      project.automationErrorAt = null;
      if (
        fullyFunded &&
        [ProjectStatus.ASSIGNED, ProjectStatus.ACTIVE].includes(project.status)
      ) {
        await manager.save(Project, project);
        return false;
      }
      await this.transitionProject(manager, project, adminUserId, {
        status: fullyFunded
          ? ProjectStatus.ASSIGNED
          : ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING,
        reason: fullyFunded
          ? 'All implementation tasks have assigned freelancers.'
          : 'Every implementation task has a reserved freelancer; implementation funding is now enabled.',
        setAssignedAt: fullyFunded,
      });
      return !fullyFunded;
    }

    if (project.status === ProjectStatus.MATCHING) {
      await this.transitionProject(manager, project, adminUserId, {
        status: ProjectStatus.MATCHED,
        reason: 'Implementation task assignment started.',
      });
    }
    return false;
  }

  async recoverImplementationFundingReadyNotifications() {
    const projects = await this.projectRepo.find({
      where: {
        status: ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING,
        automationStatus: 'implementation_team_ready_for_funding',
      },
      order: { updatedAt: 'ASC' },
      take: 25,
    });
    let notified = 0;
    for (const project of projects) {
      if (await this.notifyImplementationFundingReady(project)) notified += 1;
    }
    return { inspected: projects.length, notified };
  }

  private async notifyImplementationFundingReady(project: Project) {
    const implementationAmount = projectFundingBreakdown(
      project.budgetAllocation,
    )?.implementationAmount;
    try {
      await this.notificationsService.ensureImplementationFundingReadyNotification(
        {
          userId: project.customerId,
          projectId: project.id,
          title: 'Your implementation team is ready to fund',
          body: `Every Scrum task now has an accepted freelancer, so the implementation payment lock has been removed. Fund the implementation escrow${implementationAmount ? ` (${implementationAmount} ${project.quotedCurrency ?? project.currency})` : ''} to start work and all deadline counters together.`,
          actionUrl: `/projects/${project.id}/payments`,
          metadata: { fundingStage: 'implementation' },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Implementation funding-ready notification failed for ${project.id}: ${this.safeErrorMessage(error)}`,
      );
      return false;
    }
    await this.projectRepo.update(
      {
        id: project.id,
        status: ProjectStatus.READY_FOR_IMPLEMENTATION_FUNDING,
        automationStatus: 'implementation_team_ready_for_funding',
      },
      { automationStatus: 'implementation_team_ready_for_funding_notified' },
    );
    return true;
  }

  // ---------------------------------------------------------------------------
  // List / detail
  // ---------------------------------------------------------------------------

  async listRuns(
    projectId: string,
    query: {
      status?: string;
      targetRoleKey?: string;
      targetType?: string;
      targetTaskId?: string;
      page: number;
      limit: number;
    },
  ) {
    await this.getProject(projectId);

    const where: Record<string, unknown> = { projectId };
    if (query.status) where.status = query.status;
    if (query.targetRoleKey) where.targetRoleKey = query.targetRoleKey;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetTaskId) where.targetTaskId = query.targetTaskId;

    const [runs, total] = await this.runRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const runIds = runs.map((run) => run.id);
    const [counts, selected, invitations] = await Promise.all([
      this.getCandidateCounts(runIds),
      this.getSelectedCandidateIds(runIds),
      this.getLatestInvitations(runIds),
    ]);

    const data = runs.map((run) => ({
      id: run.id,
      projectId: run.projectId,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      targetTaskId: run.targetTaskId,
      taskTitle: (run.inputSnapshot?.taskTitle as string | undefined) ?? null,
      status: run.status,
      summary: run.summary,
      error: run.error,
      failureCategory: this.matchingFailureCategory(run.error),
      actionRequired: this.matchingFailureAction(run.error),
      candidateCount: counts.get(run.id) ?? 0,
      selectedCandidateId: selected.get(run.id) ?? null,
      invitation: invitations.get(run.id) ?? null,
      reviewedBy: run.reviewedBy,
      reviewedAt: run.reviewedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    }));

    return { data, total };
  }

  async adminListRuns(query: {
    status?: string;
    targetType?: string;
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.targetType) where.targetType = query.targetType;

    const [runs, total] = await this.runRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: ['project'],
    });

    const runIds = runs.map((run) => run.id);
    const [counts, selected, invitations] = await Promise.all([
      this.getCandidateCounts(runIds),
      this.getSelectedCandidateIds(runIds),
      this.getLatestInvitations(runIds),
    ]);

    const data = runs.map((run) => ({
      id: run.id,
      projectId: run.projectId,
      projectTitle: run.project?.title ?? null,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      targetTaskId: run.targetTaskId,
      taskTitle: (run.inputSnapshot?.taskTitle as string | undefined) ?? null,
      status: run.status,
      summary: run.summary,
      error: run.error,
      failureCategory: this.matchingFailureCategory(run.error),
      actionRequired: this.matchingFailureAction(run.error),
      projectAutomationStatus: run.project?.automationStatus ?? null,
      projectAutomationError: run.project?.automationError ?? null,
      projectAutomationErrorCategory:
        run.project?.automationErrorCategory ?? null,
      candidateCount: counts.get(run.id) ?? 0,
      selectedCandidateId: selected.get(run.id) ?? null,
      invitation: invitations.get(run.id) ?? null,
      reviewedAt: run.reviewedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    }));
    return { data, total };
  }

  async adminWorkflowDiagnostics() {
    const blocked = await this.projectRepo.find({
      where: { automationStatus: 'staffing_blocked' },
      order: { automationErrorAt: 'DESC', updatedAt: 'DESC' },
      take: 100,
    });
    return blocked.map((project) => ({
      projectId: project.id,
      projectTitle: project.title,
      projectStatus: project.status,
      automationStatus: project.automationStatus,
      category:
        project.automationErrorCategory ??
        this.matchingFailureCategory(project.automationError),
      error: project.automationError,
      actionRequired: this.matchingFailureAction(project.automationError),
      occurredAt: project.automationErrorAt,
      updatedAt: project.updatedAt,
    }));
  }

  async getRun(runId: string) {
    const run = await this.runRepo.findOne({
      where: { id: runId },
      relations: ['project', 'targetTask', 'targetTask.dependencies'],
    });
    if (!run) throw new NotFoundException('Matching run not found');

    const [candidates, invitation] = await Promise.all([
      this.candidateRepo.find({
        where: { matchingRunId: runId },
        order: { rank: 'ASC' },
        relations: ['freelancerProfile', 'freelancerProfile.user'],
      }),
      this.invitationRepo.findOne({
        where: { matchingRunId: runId },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const selectedCandidate =
      candidates.find((candidate) =>
        ['selected', 'invited', 'assigned'].includes(candidate.status),
      ) ?? null;

    return {
      id: run.id,
      projectId: run.projectId,
      projectTitle: run.project?.title ?? null,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      targetTaskId: run.targetTaskId,
      taskTitle: (run.inputSnapshot?.taskTitle as string | undefined) ?? null,
      task: run.targetTask
        ? {
            id: run.targetTask.id,
            title: run.targetTask.title,
            description: run.targetTask.description,
            roleKey: run.targetTask.roleKey,
            requiredSkills: run.targetTask.requiredSkills ?? [],
            startsAt: run.targetTask.startsAt,
            dueAt: run.targetTask.dueAt,
            dependencies: (run.targetTask.dependencies ?? []).map(
              (dependency) => ({
                dependsOnTaskId: dependency.dependsOnTaskId,
                type: dependency.dependencyType,
                notes: dependency.notes,
              }),
            ),
          }
        : null,
      status: run.status,
      filters: run.filters,
      inputSnapshot: run.inputSnapshot,
      summary: run.summary,
      candidateCount: candidates.length,
      selectedCandidateId: selectedCandidate?.id ?? null,
      invitation: invitation ? this.buildInvitationSummary(invitation) : null,
      error: run.error,
      reviewedBy: run.reviewedBy,
      reviewedAt: run.reviewedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        matchingRunId: candidate.matchingRunId,
        freelancerProfileId: candidate.freelancerProfileId,
        rank: candidate.rank,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        rationale: candidate.rationale,
        evidence: candidate.evidence,
        status: candidate.status,
        freelancer: this.buildFreelancerSummary(candidate.freelancerProfile),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Candidate status
  // ---------------------------------------------------------------------------

  async updateCandidateStatus(
    candidateId: string,
    dto: UpdateCandidateStatusDto,
    adminUserId: string,
  ) {
    if (dto.status === 'rejected' && !dto.reason?.trim()) {
      throw new BadRequestException(
        'A reason is required to reject a candidate',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const candidate = await manager.findOne(MatchingCandidate, {
        where: { id: candidateId },
      });
      if (!candidate) throw new NotFoundException('Candidate not found');

      if (dto.status === 'selected') {
        await manager
          .createQueryBuilder()
          .update(MatchingCandidate)
          .set({ status: 'shortlisted' })
          .where('matching_run_id = :runId', {
            runId: candidate.matchingRunId,
          })
          .andWhere('id != :id', { id: candidate.id })
          .andWhere('status = :selected', { selected: 'selected' })
          .execute();

        candidate.status = 'selected';
        candidate.selectedBy = adminUserId;
        candidate.selectedAt = new Date();
        candidate.rejectionReason = null;
      } else if (dto.status === 'rejected') {
        candidate.status = 'rejected';
        candidate.rejectionReason = dto.reason ?? null;
      } else {
        candidate.status = 'shortlisted';
      }

      await manager.save(MatchingCandidate, candidate);

      return {
        id: candidate.id,
        status: candidate.status,
        selectedBy: candidate.selectedBy,
        selectedAt: candidate.selectedAt,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Review run (+ optional assignment)
  // ---------------------------------------------------------------------------

  async reviewRun(runId: string, dto: ReviewRunDto, adminUserId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Matching run not found');
    if (dto.decision === 'approved' && !dto.selectedCandidateId) {
      throw new BadRequestException(
        'selectedCandidateId is required to approve a matching run',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      run.reviewedBy = adminUserId;
      run.reviewedAt = new Date();
      run.status = dto.decision === 'rerun_required' ? 'completed' : 'reviewed';
      await manager.save(MatchingRun, run);

      if (dto.decision !== 'approved') {
        return { assignment: null, notifyUserId: null as string | null };
      }

      const candidate = await manager.findOne(MatchingCandidate, {
        where: { id: dto.selectedCandidateId!, matchingRunId: run.id },
        relations: ['freelancerProfile'],
      });
      if (!candidate || !candidate.freelancerProfileId) {
        throw new NotFoundException(
          'Selected candidate not found for this run',
        );
      }

      candidate.status = 'selected';
      candidate.selectedBy = adminUserId;
      candidate.selectedAt = candidate.selectedAt ?? new Date();
      await manager.save(MatchingCandidate, candidate);

      if (!dto.createAssignment) {
        return { assignment: null, notifyUserId: null };
      }

      const assignment = await this.createPlanningAssignment(manager, {
        run,
        candidate,
        adminUserId,
        notes: dto.notes ?? null,
      });
      candidate.status = 'assigned';
      await manager.save(MatchingCandidate, candidate);

      await this.maybeAdvanceToPlanningAssigned(
        manager,
        run.projectId,
        adminUserId,
      );

      return {
        assignment,
        notifyUserId: candidate.freelancerProfile?.userId ?? null,
      };
    });

    if (result.notifyUserId && result.assignment) {
      await this.notificationsService.createNotification({
        userId: result.notifyUserId,
        projectId: run.projectId,
        title: 'New planning assignment',
        body: `You were assigned as ${run.targetRoleKey} for a project.`,
      });
    }
    await this.publishImplementationCapacityBlockIfNeeded(run.projectId);

    return {
      runId: run.id,
      status: run.status,
      assignment: result.assignment
        ? {
            id: result.assignment.id,
            projectId: result.assignment.projectId,
            phase: result.assignment.phase,
            roleKey: result.assignment.roleKey,
            status: result.assignment.status,
            freelancerProfileId: result.assignment.freelancerProfileId,
          }
        : null,
    };
  }

  async reviewRunWithInvitation(
    runId: string,
    dto: ReviewRunDto,
    reviewerUserId: string,
  ) {
    if (dto.decision !== 'approved') {
      return this.reviewRun(
        runId,
        { ...dto, createAssignment: false },
        reviewerUserId,
      );
    }
    if (!dto.selectedCandidateId) {
      throw new BadRequestException(
        'selectedCandidateId is required to approve a matching run',
      );
    }
    if (dto.createAssignment) {
      throw new BadRequestException(
        'Reviewer selections must use the invitation flow',
      );
    }

    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Matching run not found');
    if (run.targetRoleKey === PRINCIPAL_REVIEWER_ROLE) {
      throw new BadRequestException(
        'Principal-reviewer staffing is automatic and cannot review itself',
      );
    }
    if (!['completed', 'reviewed'].includes(run.status)) {
      throw new ConflictException(
        'Candidate selection is available only after matching completes',
      );
    }
    if (run.targetType !== 'task' && run.targetRoleKey) {
      const filledAssignment = await this.dataSource
        .getRepository(ProjectRoleAssignment)
        .exists({
          where: {
            projectId: run.projectId,
            roleKey: run.targetRoleKey,
            status: In(ROLE_FILLED_STATUSES),
            endedAt: IsNull(),
          },
        });
      if (filledAssignment) {
        throw new ConflictException(
          'This project role has already been selected and cannot be selected again.',
        );
      }
    }

    const candidate = await this.candidateRepo.findOne({
      where: {
        id: dto.selectedCandidateId,
        matchingRunId: run.id,
      },
    });
    if (!candidate?.freelancerProfileId) {
      throw new NotFoundException('Selected candidate not found for this run');
    }
    if (candidate.rank < 1 || candidate.rank > REVIEWER_SHORTLIST_LIMIT) {
      throw new BadRequestException(
        `The principal reviewer can choose only from the top ${REVIEWER_SHORTLIST_LIMIT} candidates`,
      );
    }

    const invitation = await this.inviteNextCandidate(
      run.id,
      candidate.id,
      reviewerUserId,
    );
    if (!invitation) {
      throw new ConflictException(
        'The selected freelancer is no longer eligible. Refresh the shortlist and choose another candidate.',
      );
    }

    return {
      runId: run.id,
      status: 'reviewed',
      assignment: null,
      invitation: this.buildInvitationSummary(invitation),
    };
  }

  async listInvitations(userId: string, status?: string) {
    const profile = await this.getProfileByUserId(userId);
    const query = this.invitationRepo
      .createQueryBuilder('invitation')
      .innerJoinAndSelect('invitation.project', 'project')
      .leftJoinAndSelect('invitation.task', 'task')
      .where('invitation.freelancerProfileId = :profileId', {
        profileId: profile.id,
      })
      .andWhere('project.deletedAt IS NULL')
      .orderBy('invitation.createdAt', 'DESC');
    if (status) query.andWhere('invitation.status = :status', { status });
    const invitations = await query.getMany();
    return invitations.map((invitation) => ({
      ...invitation,
      githubUsername: profile.githubUsername,
      githubReady: Boolean(profile.githubUsername),
    }));
  }

  async respondToInvitation(
    invitationId: string,
    userId: string,
    decision: 'accepted' | 'declined',
    reason?: string,
  ) {
    const profile = await this.getProfileByUserId(userId);
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId, freelancerProfileId: profile.id },
      relations: [
        'project',
        'task',
        'candidate',
        'candidate.freelancerProfile',
        'matchingRun',
      ],
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'pending') {
      throw new ConflictException('This invitation has already been resolved');
    }
    if (invitation.expiresAt <= new Date()) {
      await this.expireInvitation(invitation);
      throw new ConflictException(
        'This invitation expired and the next candidate is being invited',
      );
    }

    if (decision === 'declined') {
      const declined = await this.dataSource.transaction(async (manager) => {
        const locked = await manager
          .getRepository(ProjectInvitation)
          .createQueryBuilder('invitation')
          .setLock('pessimistic_write')
          .where('invitation.id = :id', { id: invitation.id })
          .getOne();
        if (
          !locked ||
          locked.status !== 'pending' ||
          locked.expiresAt <= new Date()
        ) {
          return false;
        }
        locked.status = 'declined';
        locked.respondedAt = new Date();
        locked.responseReason = reason?.trim() || null;
        await manager.save(ProjectInvitation, locked);
        if (locked.candidateId) {
          await manager.update(MatchingCandidate, locked.candidateId, {
            status: 'rejected',
            rejectionReason:
              reason?.trim() || 'Freelancer declined the invitation',
          });
        }
        if (locked.taskId) {
          await manager.update(ProjectTask, locked.taskId, {
            assignmentStatus: 'unassigned',
          });
        }
        invitation.status = locked.status;
        invitation.respondedAt = locked.respondedAt;
        invitation.responseReason = locked.responseReason;
        return true;
      });
      if (!declined) {
        await this.expireInvitation(invitation);
        throw new ConflictException(
          'This invitation is no longer pending and matching has continued',
        );
      }
      await this.notifyProjectOwner(
        invitation.project,
        'Invitation declined',
        `${profile.user?.firstName ?? 'A freelancer'} declined the ${invitation.roleKey} invitation. The next match is being invited automatically.`,
        userId,
      );
      await this.inviteNextCandidate(invitation.matchingRunId!).catch(
        (error: unknown) =>
          this.logger.error(
            `Automatic fallback invitation failed for ${invitation.id}: ${this.errorMessage(error)}; reconciliation will retry it`,
          ),
      );
      return { id: invitation.id, status: invitation.status };
    }

    if (!profile.githubUsername?.trim()) {
      throw new BadRequestException(
        'Add your GitHub username to your freelancer profile before accepting. Your invitation will remain available until its expiry time.',
      );
    }

    if (!invitation.matchingRun || !invitation.candidate) {
      const reason =
        'The invitation is missing its matching evidence and needs manual review';
      await this.cancelInvalidInvitation(invitation, reason);
      if (!invitation.matchingRunId) {
        await this.markStaffingBlocked(invitation.projectId, reason);
      }
      throw new ConflictException(
        `${reason}. It was cancelled so it cannot remain stuck as pending.`,
      );
    }

    let assignment: ProjectRoleAssignment | null = null;
    if (invitation.phase === 'implementation') {
      if (!invitation.taskId) {
        throw new ConflictException('Task invitation has no task');
      }
      const claimed = await this.invitationRepo
        .createQueryBuilder()
        .update(ProjectInvitation)
        .set({ status: 'accepting' })
        .where('id = :id', { id: invitation.id })
        .andWhere("status = 'pending'")
        .andWhere('expires_at > NOW()')
        .execute();
      if (!claimed.affected) {
        await this.expireInvitation(invitation);
        throw new ConflictException(
          'This invitation is no longer pending and matching has continued',
        );
      }
      try {
        await this.assignTask(
          invitation.taskId,
          {
            candidateId: invitation.candidate.id,
            sourceMatchingRunId: invitation.matchingRun.id,
          },
          null,
        );
      } catch (error) {
        if (error instanceof ConflictException) {
          const cancelled = await this.cancelInvalidInvitation(
            invitation,
            error.message,
          );
          throw new ConflictException(
            cancelled
              ? `${error.message}. This invitation was cancelled and the next eligible freelancer is being invited.`
              : error.message,
          );
        }
        await this.invitationRepo
          .createQueryBuilder()
          .update(ProjectInvitation)
          .set({ status: 'pending' })
          .where('id = :id AND status = :status', {
            id: invitation.id,
            status: 'accepting',
          })
          .execute();
        throw error;
      }
      invitation.status = 'accepted';
      invitation.respondedAt = new Date();
      invitation.responseReason = reason?.trim() || null;
      await this.invitationRepo.update(
        { id: invitation.id, status: 'accepting' },
        {
          status: 'accepted',
          respondedAt: invitation.respondedAt,
          responseReason: invitation.responseReason,
        },
      );
    } else {
      try {
        assignment = await this.dataSource.transaction(async (manager) => {
          // Keep the same lock order as invitation creation: project, then
          // invitation, then freelancer profile. This prevents a concurrent
          // fallback/recovery worker from deadlocking acceptance or publishing
          // a second invitation after the final role has already accepted.
          const lockedProject = await manager
            .getRepository(Project)
            .createQueryBuilder('project')
            .setLock('pessimistic_write')
            .where('project.id = :projectId', {
              projectId: invitation.projectId,
            })
            .getOneOrFail();
          const locked = await manager
            .getRepository(ProjectInvitation)
            .createQueryBuilder('invitation')
            .setLock('pessimistic_write')
            .where('invitation.id = :id', { id: invitation.id })
            .getOne();
          if (!locked || locked.status !== 'pending') {
            throw new ConflictException('Invitation is no longer pending');
          }
          if (locked.expiresAt <= new Date()) {
            throw new ConflictException(
              'This invitation expired and matching has continued',
            );
          }
          const created = await this.createPlanningAssignment(manager, {
            run: invitation.matchingRun!,
            candidate: invitation.candidate!,
            adminUserId: null,
            notes: reason?.trim() || 'Automatically matched and accepted.',
            phase:
              invitation.phase === 'governance'
                ? 'governance'
                : invitation.phase === 'staffing'
                  ? 'staffing'
                  : 'planning',
            accepted: true,
          });
          locked.status = 'accepted';
          locked.respondedAt = new Date();
          locked.responseReason = reason?.trim() || null;
          await manager.save(ProjectInvitation, locked);

          invitation.candidate!.status = 'assigned';
          invitation.candidate!.selectedAt = new Date();
          await manager.save(MatchingCandidate, invitation.candidate!);
          invitation.matchingRun!.status = 'reviewed';
          invitation.matchingRun!.reviewedAt = new Date();
          await manager.save(MatchingRun, invitation.matchingRun!);

          if (invitation.phase === 'governance') {
            lockedProject.principalReviewerAssignmentId = created.id;
            lockedProject.staffingDeadline = new Date(
              Date.now() + PRINCIPAL_MATCHING_WINDOW_MS,
            );
            lockedProject.automationStatus = 'matching_planning_team';
            lockedProject.automationError = null;
            lockedProject.automationErrorCategory = null;
            lockedProject.automationErrorAt = null;
            await manager.save(Project, lockedProject);
          } else {
            await this.maybeAdvanceToPlanningAssigned(
              manager,
              invitation.projectId,
              null,
            );
          }
          return created;
        });
      } catch (error) {
        if (error instanceof ConflictException) {
          const cancelled = await this.cancelInvalidInvitation(
            invitation,
            error.message,
          );
          throw new ConflictException(
            cancelled
              ? `${error.message}. This invitation was cancelled and the next eligible freelancer is being invited.`
              : error.message,
          );
        }
        throw error;
      }
    }

    await this.notifyProjectOwner(
      invitation.project,
      'Invitation accepted',
      `${profile.user?.firstName ?? 'The freelancer'} accepted the ${invitation.roleKey} assignment.`,
      userId,
    );
    await this.publishImplementationCapacityBlockIfNeeded(invitation.projectId);
    if (invitation.phase === 'governance') {
      await this.autoStartPlanningRoles(invitation.projectId);
    }
    // Planning invitations reserve the team; repository access is granted only
    // after the customer funds the planning package. Implementation access is
    // likewise delayed until the second escrow stage activates all task clocks.
    return {
      id: invitation.id,
      status: 'accepted',
      assignmentId: assignment?.id ?? null,
      taskId: invitation.taskId,
    };
  }

  async expirePendingInvitations() {
    const expired = await this.invitationRepo.find({
      where: { status: 'pending', expiresAt: LessThanOrEqual(new Date()) },
      relations: ['project', 'task', 'candidate'],
      take: 100,
      order: { expiresAt: 'ASC' },
    });
    for (const invitation of expired) {
      try {
        await this.expireInvitation(invitation);
      } catch (error) {
        this.logger.error(
          `Could not expire invitation ${invitation.id}: ${this.errorMessage(error)}`,
        );
      }
    }
    return { expired: expired.length };
  }

  async recoverAcceptingInvitations() {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const accepting = await this.invitationRepo.find({
      where: {
        status: 'accepting',
        updatedAt: LessThanOrEqual(staleBefore),
      },
      relations: ['project', 'task', 'candidate'],
      take: 100,
      order: { updatedAt: 'ASC' },
    });
    let accepted = 0;
    let reset = 0;
    let expired = 0;
    for (const invitation of accepting) {
      const state = await this.dataSource.transaction(async (manager) => {
        const locked = await manager
          .getRepository(ProjectInvitation)
          .createQueryBuilder('invitation')
          .setLock('pessimistic_write')
          .where('invitation.id = :id', { id: invitation.id })
          .getOne();
        if (!locked || locked.status !== 'accepting') return 'unchanged';
        const task = locked.taskId
          ? await manager.findOne(ProjectTask, {
              where: { id: locked.taskId },
            })
          : null;
        if (task?.assignedFreelancerProfileId === locked.freelancerProfileId) {
          locked.status = 'accepted';
          locked.respondedAt = locked.respondedAt ?? new Date();
          await manager.save(ProjectInvitation, locked);
          return 'accepted';
        }
        locked.status = 'pending';
        await manager.save(ProjectInvitation, locked);
        return locked.expiresAt <= new Date() ? 'expired' : 'reset';
      });
      if (state === 'accepted') {
        accepted += 1;
        await this.notifyProjectOwner(
          invitation.project,
          'Invitation accepted',
          `The ${invitation.roleKey} assignment was recovered after an interrupted acceptance request.`,
          invitation.freelancerProfile?.userId,
        );
      } else if (state === 'expired') {
        expired += 1;
        await this.expireInvitation(invitation);
      } else if (state === 'reset') {
        reset += 1;
      }
    }
    return { inspected: accepting.length, accepted, reset, expired };
  }

  async recoverRunsMissingFallbackInvitations() {
    const runs = await this.runRepo.find({
      where: [
        {
          targetRoleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['completed', 'reviewed']),
        },
        { status: 'reviewed' },
      ],
      order: { updatedAt: 'ASC' },
      take: 100,
    });
    let recovered = 0;
    for (const run of runs) {
      try {
        const invitation = await this.inviteNextCandidate(run.id);
        if (invitation) recovered += 1;
      } catch (error) {
        this.logger.error(
          `Could not recover fallback invitation for run ${run.id}: ${this.errorMessage(error)}`,
        );
      }
    }
    return { inspected: runs.length, recovered };
  }

  async recoverBlockedStaffing() {
    const projects = await this.projectRepo.find({
      where: { automationStatus: 'staffing_blocked' },
      order: { updatedAt: 'ASC' },
      take: 10,
    });
    let restarted = 0;
    for (const project of projects) {
      const recentRun = await this.runRepo.findOne({
        where: {
          projectId: project.id,
          createdAt: MoreThan(new Date(Date.now() - 15 * 60_000)),
        },
        order: { createdAt: 'DESC' },
      });
      if (recentRun) continue;
      try {
        const reviewer = await this.dataSource
          .getRepository(ProjectRoleAssignment)
          .findOne({
            where: {
              projectId: project.id,
              phase: 'governance',
              roleKey: PRINCIPAL_REVIEWER_ROLE,
              status: In(['accepted', 'in_progress']),
            },
          });
        if (!reviewer) {
          if (await this.autoStartPrincipalReviewer(project.id)) restarted += 1;
          continue;
        }

        if (MATCH_START_ALLOWED_STATUSES.has(project.status)) {
          const planningAssignments = await this.dataSource
            .getRepository(ProjectRoleAssignment)
            .find({
              where: {
                projectId: project.id,
                phase: In(['planning', 'staffing']),
                status: In(ASSIGNMENT_ACTIVE_STATUSES),
              },
            });
          const assignedRoles = new Set(
            planningAssignments.map((assignment) => assignment.roleKey),
          );
          const missingRoles = requiredPreFundingRoles().filter(
            (role) => !assignedRoles.has(role),
          );
          if (missingRoles.length) {
            await this.startPlanningRoles(
              project.id,
              { roles: missingRoles },
              null,
            );
            restarted += missingRoles.length;
            continue;
          }
          if (await this.reconcileProjectFundingReadiness(project.id)) {
            restarted += 1;
            continue;
          }
        }

        if (IMPLEMENTATION_MATCH_ALLOWED_STATUSES.has(project.status)) {
          const tasks = await this.taskRepo.find({
            where: {
              projectId: project.id,
              assignedFreelancerProfileId: IsNull(),
              status: In(MATCHABLE_TASK_STATUSES),
            },
            select: { id: true },
            take: 25,
          });
          if (tasks.length) {
            await this.startImplementationTasks(
              project.id,
              { taskIds: tasks.map((task) => task.id), mode: 'sync' },
              null,
            );
            restarted += tasks.length;
          }
        }
      } catch (error) {
        this.logger.error(
          `Blocked staffing recovery failed for ${project.id}: ${this.errorMessage(error)}`,
        );
      }
    }
    return { inspected: projects.length, restarted };
  }

  async recoverPlanningRolesAfterReviewerAcceptance() {
    const reviewerAssignments = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .find({
        where: {
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['accepted', 'in_progress']),
        },
        order: { createdAt: 'ASC' },
        take: 20,
      });

    let restarted = 0;
    for (const assignment of reviewerAssignments) {
      const project = await this.projectRepo.findOne({
        where: { id: assignment.projectId },
        select: { id: true, status: true },
      });
      if (!project || !MATCH_START_ALLOWED_STATUSES.has(project.status)) {
        continue;
      }

      // autoStartPlanningRoles is idempotent and knows that a completed run with
      // zero candidates is not progress. Calling it here lets newly eligible
      // freelancers unblock an old empty shortlist.
      if (await this.autoStartPlanningRoles(assignment.projectId))
        restarted += 1;
    }

    return { inspected: reviewerAssignments.length, restarted };
  }

  async recoverImplementationTasksWithoutMatchingRuns() {
    const rows = await this.taskRepo
      .createQueryBuilder('task')
      .select('DISTINCT task.project_id', 'projectId')
      .innerJoin(Project, 'project', 'project.id = task.project_id')
      .leftJoin(
        MatchingRun,
        'run',
        "run.target_type = 'task' AND run.target_task_id = task.id",
      )
      .where('task.assigned_freelancer_profile_id IS NULL')
      .andWhere('task.status IN (:...taskStatuses)', {
        taskStatuses: MATCHABLE_TASK_STATUSES,
      })
      .andWhere('project.status IN (:...projectStatuses)', {
        projectStatuses: Array.from(IMPLEMENTATION_MATCH_ALLOWED_STATUSES),
      })
      .andWhere('run.id IS NULL')
      .limit(10)
      .getRawMany<{ projectId: string }>();

    let restarted = 0;
    for (const row of rows) {
      const result = await this.autoStartImplementationTasks(
        row.projectId,
        null,
      );
      if (result.triggered) restarted += 1;
    }
    return { inspected: rows.length, restarted };
  }

  async removeTaskAssignee(
    taskId: string,
    reason: string,
    actorUserId: string | null,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const task = await manager
        .getRepository(ProjectTask)
        .createQueryBuilder('task')
        .setLock('pessimistic_write')
        .where('task.id = :taskId', { taskId })
        .getOne();
      if (!task) throw new NotFoundException('Task not found');
      if (!task.assignedFreelancerProfileId) {
        throw new ConflictException('Task has no assignee to remove');
      }
      const removedProfileId = task.assignedFreelancerProfileId;
      let principalReviewerSuspendedUserId: string | null = null;
      const removedAt = new Date();
      const priorAssignedAt = task.assignedAt;
      const priorHourlyRateSnapshot = task.hourlyRateSnapshot;
      const priorHourlyRateCurrencySnapshot = task.hourlyRateCurrencySnapshot;
      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: removedProfileId },
      });
      if (profile) {
        profile.projectRemovals += 1;
        profile.performanceScore = Math.max(
          0,
          Number(profile.performanceScore) - 10,
        ).toFixed(2);
        profile.riskFlags = [
          ...(profile.riskFlags ?? []),
          {
            type: 'task_removal',
            projectId: task.projectId,
            taskId: task.id,
            reason,
            at: new Date().toISOString(),
          },
        ].slice(-20);
        if (profile.principalReviewerStatus === 'approved') {
          profile.principalReviewerStatus = 'suspended';
          profile.principalReviewerReviewedAt = new Date();
          profile.principalReviewerRejectionReason =
            'Reviewer eligibility was paused after a task removal risk event.';
          profile.principalReviewerQualification = {
            ...(profile.principalReviewerQualification ?? {}),
            suspendedAt: new Date().toISOString(),
            source: 'performance_risk',
            reason: profile.principalReviewerRejectionReason,
          };
          principalReviewerSuspendedUserId = profile.userId;
        }
        await manager.save(FreelancerProfile, profile);
        await manager.save(
          FreelancerPerformanceEvent,
          manager.create(FreelancerPerformanceEvent, {
            freelancerProfileId: profile.id,
            projectId: task.projectId,
            taskId: task.id,
            eventType: 'task_removed',
            scoreDelta: '-10.00',
            moneyDelta: '0.00',
            currency: task.currency,
            reason,
            metadata: { actorUserId },
          }),
        );
      }
      task.assignedFreelancerProfileId = null;
      task.assignedAt = null;
      task.assignedBy = null;
      task.hourlyRateSnapshot = null;
      task.hourlyRateCurrencySnapshot = null;
      task.assignmentStatus = 'unassigned';
      task.status = 'todo';
      const currentPenalty = Math.max(0, Number(task.penaltyAmount ?? 0));
      const currentBudget = Math.max(0, Number(task.budgetAmount ?? 0));
      task.metadata = {
        ...(task.metadata ?? {}),
        assignmentHistory: [
          ...this.metadataArray(task.metadata?.assignmentHistory),
          {
            freelancerProfileId: removedProfileId,
            assignedAt: priorAssignedAt?.toISOString() ?? null,
            endedAt: removedAt.toISOString(),
            reason,
            hourlyRateSnapshot: priorHourlyRateSnapshot,
            hourlyRateCurrencySnapshot: priorHourlyRateCurrencySnapshot,
            penaltyAmount: currentPenalty.toFixed(2),
            budgetBeforePenalty: currentBudget.toFixed(2),
          },
        ].slice(-20),
      };
      if (currentPenalty > 0) {
        task.budgetAmount = Math.max(0, currentBudget - currentPenalty).toFixed(
          2,
        );
      }
      task.penaltyAmount = '0.00';
      task.deadlineStrikes = 0;
      const checkpoints = await manager.getRepository(TaskCheckpoint).find({
        where: { taskId: task.id },
      });
      for (const checkpoint of checkpoints) {
        checkpoint.metadata = {
          ...(checkpoint.metadata ?? {}),
          assignmentHistory: [
            ...this.metadataArray(checkpoint.metadata?.assignmentHistory),
            {
              freelancerProfileId: removedProfileId,
              status: checkpoint.status,
              completedAt: checkpoint.completedAt?.toISOString() ?? null,
              assessedAt: checkpoint.assessedAt?.toISOString() ?? null,
              penaltyAmount: checkpoint.penaltyAmount,
              endedAt: removedAt.toISOString(),
            },
          ].slice(-20),
        };
        checkpoint.status = 'pending';
        checkpoint.completedAt = null;
        checkpoint.assessedAt = null;
        checkpoint.penaltyAmount = '0.00';
      }
      if (checkpoints.length) {
        await manager.getRepository(TaskCheckpoint).save(checkpoints);
      }
      await manager.save(ProjectTask, task);
      return { task, removedProfileId, principalReviewerSuspendedUserId };
    });

    if (result.principalReviewerSuspendedUserId) {
      await this.notificationsService.createNotification({
        userId: result.principalReviewerSuspendedUserId,
        projectId: result.task.projectId,
        taskId: result.task.id,
        type: 'principal_reviewer_status',
        title: 'Principal reviewer eligibility paused',
        body: 'A task removal created a performance risk flag. Principal reviewer matching is paused until an administrator reviews it.',
        actionUrl: '/profile',
      });
    }

    const existingRun = result.task.sourceMatchingRunId
      ? await this.runRepo.findOne({
          where: { id: result.task.sourceMatchingRunId },
        })
      : null;
    await this.repositoriesService
      .revokeIfNoLongerAssigned(result.task.projectId, result.removedProfileId)
      .catch((error: unknown) =>
        this.logger.error(
          `Automatic repository revocation failed for removed assignee ${result.removedProfileId}: ${this.errorMessage(error)}`,
        ),
      );
    const invitation = existingRun
      ? await this.inviteNextCandidate(existingRun.id)
      : null;
    if (!invitation) {
      await this.startImplementationTasks(
        result.task.projectId,
        { taskIds: [result.task.id], mode: 'sync' },
        actorUserId,
      );
    }
    return {
      taskId: result.task.id,
      removedFreelancerProfileId: result.removedProfileId,
      rematching: true,
    };
  }

  async removePlanningAssignee(
    projectId: string,
    roleKey: string,
    reason: string,
    actorUserId: string | null,
  ) {
    const phase =
      staffingRoleBase(roleKey) === 'implementation' ? 'staffing' : 'planning';
    const result = await this.dataSource.transaction(async (manager) => {
      const assignment = await manager
        .getRepository(ProjectRoleAssignment)
        .createQueryBuilder('assignment')
        .setLock('pessimistic_write')
        .where('assignment.projectId = :projectId', { projectId })
        .andWhere('assignment.phase = :phase', { phase })
        .andWhere('assignment.roleKey = :roleKey', { roleKey })
        .andWhere('assignment.endedAt IS NULL')
        .getOne();
      if (!assignment?.freelancerProfileId) {
        throw new ConflictException('Staffing role has no active assignee');
      }
      const removedProfileId = assignment.freelancerProfileId;
      assignment.status = 'removed';
      assignment.endedAt = new Date();
      assignment.decisionReason = reason;
      await manager.save(ProjectRoleAssignment, assignment);

      const profile = await manager.findOne(FreelancerProfile, {
        where: { id: removedProfileId },
      });
      if (profile) {
        profile.projectRemovals += 1;
        profile.riskFlags = [
          ...(profile.riskFlags ?? []),
          {
            type:
              phase === 'staffing'
                ? 'prefunding_implementation_rejection'
                : 'planning_role_rejection',
            projectId,
            roleKey,
            reason,
            at: new Date().toISOString(),
          },
        ].slice(-20);
        await manager.save(FreelancerProfile, profile);
      }
      const project = await manager.findOne(Project, {
        where: { id: projectId },
      });
      if (project) {
        project.status = ProjectStatus.PLANNING_MATCHING;
        project.planningStatus = 'matching';
        project.automationStatus = 'awaiting_planning_team';
        project.automationError = null;
        project.automationErrorCategory = null;
        project.automationErrorAt = null;
        await manager.save(Project, project);
      }
      return {
        removedProfileId,
        sourceMatchingRunId: assignment.sourceMatchingRunId,
      };
    });

    await this.repositoriesService
      .revokeIfNoLongerAssigned(projectId, result.removedProfileId)
      .catch((error: unknown) =>
        this.logger.error(
          `Automatic repository revocation failed for rejected ${roleKey} assignee ${result.removedProfileId}: ${this.errorMessage(error)}`,
        ),
      );
    const existingRun = result.sourceMatchingRunId
      ? await this.runRepo.findOne({
          where: { id: result.sourceMatchingRunId },
        })
      : null;
    const invitation = existingRun
      ? await this.inviteNextCandidate(existingRun.id)
      : null;
    if (!invitation) {
      await this.startPlanningRoles(
        projectId,
        { roles: [roleKey], filters: undefined },
        actorUserId,
      );
    }
    return {
      projectId,
      roleKey,
      removedFreelancerProfileId: result.removedProfileId,
      rematching: true,
    };
  }

  async isPrincipalReviewer(userId: string, projectId: string) {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) return false;
    return Boolean(
      await this.dataSource.getRepository(ProjectRoleAssignment).findOne({
        where: {
          projectId,
          freelancerProfileId: profile.id,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['accepted', 'in_progress', 'completed']),
        },
      }),
    );
  }

  private async rebaseTaskSchedule(
    manager: EntityManager,
    task: ProjectTask,
    project: Project,
    assignedAt: Date,
  ) {
    const priorStart = task.startsAt ?? assignedAt;
    const priorDue =
      task.dueAt ?? new Date(priorStart.getTime() + 24 * 60 * 60 * 1000);
    const durationMs = Math.max(
      60 * 60 * 1000,
      priorDue.getTime() - priorStart.getTime(),
    );
    const nextStart =
      priorStart.getTime() > assignedAt.getTime() ? priorStart : assignedAt;
    const shiftMs = Math.max(0, nextStart.getTime() - priorStart.getTime());
    const nextDue = new Date(nextStart.getTime() + durationMs);
    task.metadata = {
      ...(task.metadata ?? {}),
      plannedStartsAt:
        task.metadata?.plannedStartsAt ?? priorStart.toISOString(),
      plannedDueAt: task.metadata?.plannedDueAt ?? priorDue.toISOString(),
      scheduleRebasedAt: assignedAt.toISOString(),
      scheduleRebaseCount:
        Number(task.metadata?.scheduleRebaseCount ?? 0) + (shiftMs > 0 ? 1 : 0),
    };
    task.startsAt = nextStart;
    task.dueAt = nextDue;

    if (shiftMs > 0) {
      const checkpoints = await manager.getRepository(TaskCheckpoint).find({
        where: { taskId: task.id, status: In(['pending', 'deferred']) },
      });
      for (const checkpoint of checkpoints) {
        checkpoint.dueAt = new Date(checkpoint.dueAt.getTime() + shiftMs);
        checkpoint.status = 'pending';
        checkpoint.assessedAt = null;
      }
      if (checkpoints.length) {
        await manager.getRepository(TaskCheckpoint).save(checkpoints);
      }
    }
    return Boolean(project.deadline && nextDue > project.deadline);
  }

  private metadataArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            !Array.isArray(entry),
        )
      : [];
  }

  private async inviteNextCandidate(
    runId: string,
    preferredCandidateId?: string,
    selectedBy?: string,
  ): Promise<ProjectInvitation | null> {
    const run = await this.runRepo.findOne({
      where: { id: runId },
      relations: ['project', 'targetTask'],
    });
    if (!run || !['completed', 'reviewed'].includes(run.status)) return null;
    const roleKey = run.targetRoleKey ?? 'implementation';
    if (run.targetTaskId) {
      const taskAlreadyAssigned = await this.taskRepo.exists({
        where: {
          id: run.targetTaskId,
          assignedFreelancerProfileId: Not(IsNull()),
        },
      });
      if (taskAlreadyAssigned) return null;
    } else {
      const roleAlreadyAssigned = await this.dataSource
        .getRepository(ProjectRoleAssignment)
        .exists({
          where: {
            projectId: run.projectId,
            roleKey,
            status: In(ROLE_FILLED_STATUSES),
          },
        });
      if (roleAlreadyAssigned) return null;
    }
    const existing = await this.invitationRepo.findOne({
      where: {
        projectId: run.projectId,
        taskId: run.targetTaskId ?? IsNull(),
        roleKey,
        status: In(['pending', 'accepting']),
      },
    });
    if (existing) {
      if (
        preferredCandidateId &&
        existing.candidateId !== preferredCandidateId
      ) {
        throw new ConflictException(
          'Another candidate already has an active invitation for this role',
        );
      }
      return existing;
    }

    let candidates = await this.candidateRepo.find({
      where: {
        matchingRunId: run.id,
        status: In(['recommended', 'shortlisted', 'selected']),
      },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
      order: { rank: 'ASC' },
    });
    if (preferredCandidateId) {
      candidates = candidates.filter(
        (candidate) => candidate.id === preferredCandidateId,
      );
      if (!candidates.length) {
        throw new ConflictException(
          'The selected candidate is no longer available in this shortlist',
        );
      }
    }
    const candidateIds = candidates
      .map((entry) => entry.freelancerProfileId)
      .filter((id): id is string => Boolean(id));
    const pendingInvitationsPromise: Promise<ProjectInvitation[]> =
      candidateIds.length > 0
        ? this.invitationRepo.find({
            select: {
              freelancerProfileId: true,
              projectId: true,
              taskId: true,
            },
            where: {
              freelancerProfileId: In(candidateIds),
              status: In(['pending', 'accepting']),
            },
          })
        : Promise.resolve([]);
    const activeAssignmentsPromise: Promise<ProjectRoleAssignment[]> =
      candidateIds.length > 0
        ? this.dataSource.getRepository(ProjectRoleAssignment).find({
            select: { freelancerProfileId: true },
            where: {
              projectId: run.projectId,
              freelancerProfileId: In(candidateIds),
              status: In(ASSIGNMENT_ACTIVE_STATUSES),
              ...(run.targetTaskId ? { phase: Not('staffing') } : {}),
            },
          })
        : Promise.resolve([]);
    const activeTasksPromise: Promise<ProjectTask[]> =
      candidateIds.length > 0
        ? this.taskRepo.find({
            select: { assignedFreelancerProfileId: true },
            where: {
              assignedFreelancerProfileId: In(candidateIds),
              ...(run.targetTaskId
                ? { status: In(ACTIVE_TASK_STATUSES) }
                : { projectId: run.projectId }),
            },
          })
        : Promise.resolve([]);
    const reviewerLoadsPromise: Promise<
      Array<{ profileId: string; projects: string }>
    > =
      run.targetRoleKey === PRINCIPAL_REVIEWER_ROLE && candidateIds.length > 0
        ? this.dataSource
            .getRepository(ProjectRoleAssignment)
            .createQueryBuilder('assignment')
            .select('assignment.freelancerProfileId', 'profileId')
            .addSelect('COUNT(DISTINCT assignment.projectId)', 'projects')
            .where('assignment.freelancerProfileId IN (:...candidateIds)', {
              candidateIds,
            })
            .andWhere('assignment.phase = :phase', { phase: 'governance' })
            .andWhere('assignment.roleKey = :roleKey', {
              roleKey: PRINCIPAL_REVIEWER_ROLE,
            })
            .andWhere('assignment.status IN (:...statuses)', {
              statuses: ASSIGNMENT_ACTIVE_STATUSES,
            })
            .groupBy('assignment.freelancerProfileId')
            .getRawMany<{ profileId: string; projects: string }>()
        : Promise.resolve([]);
    const [
      pendingInvitations,
      activeProjectAssignments,
      activeProjectTasks,
      reviewerLoads,
    ] = await Promise.all([
      pendingInvitationsPromise,
      activeAssignmentsPromise,
      activeTasksPromise,
      reviewerLoadsPromise,
    ]);
    const unavailableProfileIds = new Set(
      activeProjectAssignments.map((entry) => entry.freelancerProfileId),
    );
    const taskLoadByProfile = new Map<string, number>();
    for (const entry of activeProjectTasks) {
      if (!entry.assignedFreelancerProfileId) continue;
      if (!run.targetTaskId) {
        unavailableProfileIds.add(entry.assignedFreelancerProfileId);
        continue;
      }
      taskLoadByProfile.set(
        entry.assignedFreelancerProfileId,
        (taskLoadByProfile.get(entry.assignedFreelancerProfileId) ?? 0) + 1,
      );
    }
    for (const entry of pendingInvitations) {
      if (!run.targetTaskId || !entry.taskId) {
        unavailableProfileIds.add(entry.freelancerProfileId);
        continue;
      }
      taskLoadByProfile.set(
        entry.freelancerProfileId,
        (taskLoadByProfile.get(entry.freelancerProfileId) ?? 0) + 1,
      );
    }
    const reviewerLoadByProfile = new Map<string, number>(
      reviewerLoads.map(
        (entry) => [entry.profileId, Number(entry.projects)] as const,
      ),
    );
    let candidate: MatchingCandidate | null = null;
    for (const option of candidates) {
      if (!option.freelancerProfile?.isAvailable) continue;
      if (
        !option.freelancerProfileId ||
        unavailableProfileIds.has(option.freelancerProfileId)
      ) {
        continue;
      }
      if (
        run.targetTaskId &&
        !hasTaskCapacity(
          taskLoadByProfile.get(option.freelancerProfileId) ?? 0,
          0,
        )
      ) {
        continue;
      }
      if (run.targetRoleKey === PRINCIPAL_REVIEWER_ROLE) {
        const performance = Number(
          option.freelancerProfile.performanceScore ?? 100,
        );
        const activeProjects =
          reviewerLoadByProfile.get(option.freelancerProfileId) ?? 0;
        const capacity = Math.min(
          PRINCIPAL_REVIEWER_MAX_PROJECTS,
          Math.max(
            1,
            option.freelancerProfile.principalReviewerMaxProjects ??
              PRINCIPAL_REVIEWER_MAX_PROJECTS,
          ),
        );
        if (
          option.freelancerProfile.principalReviewerStatus !== 'approved' ||
          !option.freelancerProfile.principalReviewerHourlyRate ||
          performance < PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE ||
          (option.freelancerProfile.riskFlags?.length ?? 0) > 0 ||
          activeProjects >= capacity
        )
          continue;
      }
      candidate = option;
      break;
    }
    if (!candidate?.freelancerProfile) {
      if (preferredCandidateId) {
        const preferredProfileId = candidates[0]?.freelancerProfileId;
        if (
          run.targetTaskId &&
          preferredProfileId &&
          !hasTaskCapacity(taskLoadByProfile.get(preferredProfileId) ?? 0, 0)
        ) {
          throw new ConflictException(
            `A freelancer can hold at most ${MAX_ACTIVE_TASKS_PER_FREELANCER} active implementation tasks across projects`,
          );
        }
        throw new ConflictException(
          'The selected freelancer is unavailable or already assigned to this project',
        );
      }
      await this.markStaffingBlocked(
        run.projectId,
        `No eligible candidate remains for ${run.targetRoleKey ?? 'this assignment'}.`,
      );
      return null;
    }

    const phase = run.targetTaskId
      ? 'implementation'
      : run.targetRoleKey === PRINCIPAL_REVIEWER_ROLE
        ? 'governance'
        : staffingRoleBase(run.targetRoleKey ?? '') === 'implementation'
          ? 'staffing'
          : 'planning';
    let invitation: ProjectInvitation;
    try {
      invitation = await this.dataSource.transaction(async (manager) => {
        const lockedProject = await manager
          .getRepository(Project)
          .createQueryBuilder('project')
          .setLock('pessimistic_write')
          .where('project.id = :projectId', { projectId: run.projectId })
          .getOneOrFail();
        const targetInvitation = await manager.findOne(ProjectInvitation, {
          where: {
            projectId: run.projectId,
            taskId: run.targetTaskId ?? IsNull(),
            phase,
            roleKey,
            status: In(['pending', 'accepting']),
          },
        });
        if (targetInvitation) {
          if (
            preferredCandidateId &&
            targetInvitation.candidateId !== preferredCandidateId
          ) {
            throw new ConflictException(
              'Another candidate already has an active invitation for this role',
            );
          }
          return targetInvitation;
        }
        if (run.targetTaskId) {
          const lockedTask = await manager
            .getRepository(ProjectTask)
            .createQueryBuilder('task')
            .setLock('pessimistic_write')
            .where('task.id = :taskId', { taskId: run.targetTaskId })
            .getOne();
          if (!lockedTask || lockedTask.assignedFreelancerProfileId) {
            throw new ConflictException(
              'Target assignment changed concurrently',
            );
          }
        } else {
          const activeRole = await manager.exists(ProjectRoleAssignment, {
            where: {
              projectId: run.projectId,
              phase,
              roleKey,
              status: In(ASSIGNMENT_ACTIVE_STATUSES),
            },
          });
          if (activeRole) {
            throw new ConflictException(
              'Target assignment changed concurrently',
            );
          }
        }
        const lockedProfile = await manager
          .getRepository(FreelancerProfile)
          .createQueryBuilder('profile')
          .setLock('pessimistic_write')
          .where('profile.id = :profileId', {
            profileId: candidate.freelancerProfileId,
          })
          .getOne();
        if (!lockedProfile?.isAvailable) {
          throw new ConflictException(
            'Candidate reservation changed concurrently',
          );
        }
        if (run.targetTaskId) {
          const conflictingInvitation = await manager.exists(
            ProjectInvitation,
            {
              where: {
                freelancerProfileId: lockedProfile.id,
                taskId: IsNull(),
                status: In(['pending', 'accepting']),
              },
            },
          );
          const [activeTaskCount, activeInvitationCount] = await Promise.all([
            manager.count(ProjectTask, {
              where: {
                assignedFreelancerProfileId: lockedProfile.id,
                status: In(ACTIVE_TASK_STATUSES),
              },
            }),
            manager.count(ProjectInvitation, {
              where: {
                freelancerProfileId: lockedProfile.id,
                taskId: Not(IsNull()),
                status: In(['pending', 'accepting']),
              },
            }),
          ]);
          if (
            conflictingInvitation ||
            !hasTaskCapacity(activeTaskCount, activeInvitationCount)
          ) {
            throw new ConflictException(
              `A freelancer can hold at most ${MAX_ACTIVE_TASKS_PER_FREELANCER} active implementation tasks across projects`,
            );
          }
        } else {
          const activeInvitation = await manager.exists(ProjectInvitation, {
            where: {
              freelancerProfileId: lockedProfile.id,
              status: In(['pending', 'accepting']),
            },
          });
          if (activeInvitation) {
            throw new ConflictException(
              'Candidate reservation changed concurrently',
            );
          }
        }
        if (run.targetRoleKey === PRINCIPAL_REVIEWER_ROLE) {
          const [activeProjects, reservedProjects] = await Promise.all([
            manager.count(ProjectRoleAssignment, {
              where: {
                freelancerProfileId: lockedProfile.id,
                phase: 'governance',
                roleKey: PRINCIPAL_REVIEWER_ROLE,
                status: In(ASSIGNMENT_ACTIVE_STATUSES),
              },
            }),
            manager.count(ProjectInvitation, {
              where: {
                freelancerProfileId: lockedProfile.id,
                phase: 'governance',
                roleKey: PRINCIPAL_REVIEWER_ROLE,
                status: In(['pending', 'accepting']),
              },
            }),
          ]);
          const capacity = Math.min(
            PRINCIPAL_REVIEWER_MAX_PROJECTS,
            Math.max(
              1,
              lockedProfile.principalReviewerMaxProjects ??
                PRINCIPAL_REVIEWER_MAX_PROJECTS,
            ),
          );
          if (activeProjects + reservedProjects >= capacity) {
            throw new ConflictException(
              'Candidate reservation changed concurrently',
            );
          }
        }
        const created = await manager.save(
          ProjectInvitation,
          manager.create(ProjectInvitation, {
            projectId: run.projectId,
            taskId: run.targetTaskId,
            freelancerProfileId: candidate.freelancerProfileId!,
            matchingRunId: run.id,
            candidateId: candidate.id,
            phase,
            roleKey,
            status: 'pending',
            rankSnapshot: candidate.rank,
            scoreSnapshot: {
              score: Number(candidate.score),
              scoreBreakdown: candidate.scoreBreakdown,
              rationale: candidate.rationale,
            },
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
            respondedAt: null,
            responseReason: null,
            notificationStatus: 'pending',
            notificationAttempts: 0,
            notificationError: null,
            notificationSentAt: null,
          }),
        );
        candidate.status = 'invited';
        if (selectedBy) {
          await manager
            .getRepository(MatchingCandidate)
            .createQueryBuilder()
            .update(MatchingCandidate)
            .set({
              status: 'skipped',
              rejectionReason:
                'The principal reviewer selected a lower-ranked candidate',
            })
            .where('matching_run_id = :runId', { runId: run.id })
            .andWhere('rank < :selectedRank', { selectedRank: candidate.rank })
            .andWhere('status IN (:...statuses)', {
              statuses: ['recommended', 'shortlisted'],
            })
            .execute();
          candidate.selectedBy = selectedBy;
          candidate.selectedAt = new Date();
          run.reviewedBy = selectedBy;
          run.reviewedAt = new Date();
          run.status = 'reviewed';
          await manager.save(MatchingRun, run);
        }
        await manager.save(MatchingCandidate, candidate);
        if (run.targetTaskId) {
          await manager.update(ProjectTask, run.targetTaskId, {
            assignmentStatus: 'invitation_pending',
          });
        }
        if (
          phase === 'governance' &&
          lockedProject.status === ProjectStatus.WAITING_FOR_PR
        ) {
          await this.transitionProject(manager, lockedProject, null, {
            status: ProjectStatus.PLANNING_MATCHING,
            planningStatus: 'matching',
            reason: 'Reserved a principal reviewer candidate.',
          });
        }
        lockedProject.automationStatus =
          phase === 'governance'
            ? 'awaiting_principal_reviewer'
            : phase === 'planning'
              ? 'awaiting_planning_team'
              : 'awaiting_implementation_team';
        lockedProject.automationError = null;
        lockedProject.automationErrorCategory = null;
        lockedProject.automationErrorAt = null;
        await manager.save(Project, lockedProject);
        return created;
      });
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === 'Target assignment changed concurrently' &&
        !preferredCandidateId
      ) {
        return null;
      }
      if (
        error instanceof ConflictException &&
        error.message === 'Candidate reservation changed concurrently' &&
        !preferredCandidateId
      ) {
        await this.candidateRepo.update(
          {
            id: candidate.id,
            status: In(['recommended', 'shortlisted', 'selected']),
          },
          {
            status: 'skipped',
            rejectionReason: 'Candidate was reserved by another project first',
          },
        );
        return this.inviteNextCandidate(runId);
      }
      throw error;
    }
    await this.incidents?.resolveOperation(
      'matching',
      'staff_project',
      run.projectId,
    );
    await this.deliverInvitationNotification(invitation.id);
    return invitation;
  }

  async recoverUndeliveredInvitationNotifications() {
    const rows = await this.invitationRepo.find({
      where: {
        status: 'pending',
        notificationStatus: In(['pending', 'failed', 'sending']),
      },
      order: { updatedAt: 'ASC' },
      take: 50,
    });
    let delivered = 0;
    for (const row of rows) {
      if (
        row.notificationStatus === 'sending' &&
        row.updatedAt.getTime() > Date.now() - 2 * 60_000
      ) {
        continue;
      }
      if (await this.deliverInvitationNotification(row.id)) delivered += 1;
    }
    return { inspected: rows.length, delivered };
  }

  private async deliverInvitationNotification(invitationId: string) {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const invitation = await manager
        .getRepository(ProjectInvitation)
        .createQueryBuilder('invitation')
        .setLock('pessimistic_write', undefined, ['invitation'])
        .leftJoinAndSelect('invitation.project', 'project')
        .leftJoinAndSelect('invitation.task', 'task')
        .leftJoinAndSelect('invitation.freelancerProfile', 'profile')
        .where('invitation.id = :invitationId', { invitationId })
        .getOne();
      if (!invitation || invitation.status !== 'pending') return null;
      if (invitation.notificationStatus === 'sent') return null;
      if (
        invitation.notificationStatus === 'sending' &&
        invitation.updatedAt.getTime() > Date.now() - 2 * 60_000
      ) {
        return null;
      }
      invitation.notificationStatus = 'sending';
      invitation.notificationAttempts += 1;
      invitation.notificationError = null;
      return manager.save(ProjectInvitation, invitation);
    });
    if (!claimed?.freelancerProfile?.userId) return false;
    try {
      await this.notificationsService.ensureProjectInvitationNotification(
        claimed.id,
        {
          userId: claimed.freelancerProfile.userId,
          projectId: claimed.projectId,
          taskId: claimed.taskId,
          title: 'Project invitation',
          body: `You are invited to ${claimed.project?.title ?? 'a Nexus AI project'} as ${this.businessRoleLabel(claimed.roleKey)}${claimed.task?.title ? ` for “${claimed.task.title}”` : ''}. Please accept or decline within ${INVITATION_WINDOW_LABEL}.`,
          actionUrl: '/invitations',
          metadata: {
            expiresAt: claimed.expiresAt.toISOString(),
            phase: claimed.phase,
          },
        },
      );
      await this.invitationRepo.update(claimed.id, {
        notificationStatus: 'sent',
        notificationSentAt: new Date(),
        notificationError: null,
      });
      return true;
    } catch (error) {
      const message = this.safeErrorMessage(error);
      await this.invitationRepo.update(claimed.id, {
        notificationStatus: 'failed',
        notificationError: message,
      });
      this.logger.warn(
        `Invitation ${claimed.id} persisted but its notification failed: ${message}`,
      );
      return false;
    }
  }

  private async expireInvitation(invitation: ProjectInvitation) {
    const expired = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(ProjectInvitation)
        .createQueryBuilder('invitation')
        .setLock('pessimistic_write')
        .where('invitation.id = :id', { id: invitation.id })
        .getOne();
      if (
        !locked ||
        locked.status !== 'pending' ||
        locked.expiresAt > new Date()
      ) {
        return false;
      }
      locked.status = 'expired';
      locked.respondedAt = new Date();
      locked.responseReason = `No response within the ${INVITATION_WINDOW_LABEL} window`;
      await manager.save(ProjectInvitation, locked);
      if (locked.candidateId) {
        await manager
          .getRepository(MatchingCandidate)
          .update({ id: locked.candidateId }, { status: 'expired' });
      }
      if (locked.taskId) {
        await manager.getRepository(ProjectTask).update(locked.taskId, {
          assignmentStatus: 'unassigned',
        });
      }
      invitation.status = 'expired';
      invitation.respondedAt = locked.respondedAt;
      invitation.responseReason = locked.responseReason;
      return true;
    });
    if (!expired) return;
    const profile = await this.profileRepo.findOne({
      where: { id: invitation.freelancerProfileId },
    });
    if (profile)
      await this.notificationsService
        .createNotification({
          userId: profile.userId,
          projectId: invitation.projectId,
          taskId: invitation.taskId,
          type: 'invitation_expired',
          title: 'Invitation expired',
          body: `The ${INVITATION_WINDOW_LABEL} response window ended and the project moved to the next match.`,
          actionUrl: '/invitations',
        })
        .catch(() => undefined);
    await this.notifyProjectOwner(
      invitation.project,
      'Invitation expired',
      `The ${invitation.roleKey} invitation expired after ${INVITATION_WINDOW_LABEL}. The next eligible freelancer is being invited automatically.`,
      profile?.userId,
    );
    if (invitation.matchingRunId) {
      await this.inviteNextCandidate(invitation.matchingRunId);
    }
  }

  private async getProfileByUserId(userId: string) {
    const profile = await this.profileRepo.findOne({
      where: { userId },
      relations: ['user'],
    });
    if (!profile) throw new NotFoundException('Freelancer profile not found');
    return profile;
  }

  private async cancelInvalidInvitation(
    invitation: ProjectInvitation,
    reason: string,
  ) {
    const cancelled = await this.invitationRepo.update(
      {
        id: invitation.id,
        status: In(['pending', 'accepting']),
      },
      {
        status: 'cancelled',
        respondedAt: new Date(),
        responseReason: reason,
      },
    );
    if (!cancelled.affected) return false;
    if (invitation.candidateId) {
      await this.candidateRepo.update(invitation.candidateId, {
        status: 'rejected',
        rejectionReason: reason,
      });
    }
    if (invitation.taskId) {
      await this.taskRepo.update(invitation.taskId, {
        assignmentStatus: 'unassigned',
      });
    }
    if (invitation.matchingRunId) {
      await this.inviteNextCandidate(invitation.matchingRunId);
    }
    return true;
  }

  private async notifyProjectOwner(
    project: Project,
    title: string,
    body: string,
    actorUserId?: string,
    options?: {
      customerActionUrl?: string;
      customerType?: string;
    },
  ) {
    await this.notificationsService
      .createNotification({
        userId: project.customerId,
        projectId: project.id,
        type: options?.customerType ?? 'staffing_update',
        title,
        body,
        actionUrl: options?.customerActionUrl ?? `/projects/${project.id}/team`,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Customer staffing notification failed for ${project.id}: ${this.safeErrorMessage(error)}`,
        ),
      );
    const reviewer = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId: project.id,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['accepted', 'in_progress']),
        },
        relations: ['freelancerProfile'],
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not resolve the principal reviewer for ${project.id}: ${this.safeErrorMessage(error)}`,
        );
        return null;
      });
    const reviewerUserId = reviewer?.freelancerProfile?.userId;
    if (reviewerUserId && reviewerUserId !== actorUserId) {
      await this.notificationsService
        .createNotification({
          userId: reviewerUserId,
          projectId: project.id,
          type: 'reviewer_attention',
          title,
          body,
          actionUrl: `/reviewer/projects/${project.id}`,
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `Reviewer staffing notification failed for ${project.id}: ${this.safeErrorMessage(error)}`,
          ),
        );
    }
  }

  private async markAwaitingReviewerSelection(
    project: Project,
    runs: Record<string, unknown>[],
  ) {
    await this.projectRepo.update(project.id, {
      automationStatus: 'awaiting_reviewer_selection',
      automationError: null,
      automationErrorCategory: null,
      automationErrorAt: null,
    });
    await this.incidents?.resolveOperation(
      'matching',
      'staff_project',
      project.id,
    );
    const reviewer = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId: project.id,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['accepted', 'in_progress']),
        },
        relations: ['freelancerProfile'],
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not resolve shortlist reviewer for ${project.id}: ${this.safeErrorMessage(error)}`,
        );
        return null;
      });
    const reviewerUserId = reviewer?.freelancerProfile?.userId;
    if (!reviewerUserId) return;

    const labels = runs
      .map((run) => {
        const taskTitle =
          typeof run.taskTitle === 'string'
            ? run.taskTitle
            : 'implementation task';
        const roleKey =
          typeof run.targetRoleKey === 'string' ? run.targetRoleKey : 'role';
        return run.targetType === 'task'
          ? taskTitle
          : this.businessRoleLabel(roleKey);
      })
      .slice(0, 4);
    const suffix = runs.length > labels.length ? ' and more' : '';
    await this.notificationsService
      .createNotification({
        userId: reviewerUserId,
        projectId: project.id,
        type: 'reviewer_attention',
        title: 'Candidate shortlists ready',
        body: `Choose one of the top three candidates for ${labels.join(', ')}${suffix}. The selected freelancer will receive a ${INVITATION_WINDOW_LABEL} invitation.`,
        actionUrl: `/reviewer/projects/${project.id}`,
        metadata: {
          matchingRunIds: runs.map((run) => run.id),
        },
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Shortlist notification failed for ${project.id}: ${this.safeErrorMessage(error)}`,
        ),
      );
  }

  private async markStaffingBlocked(projectId: string, reason: string) {
    try {
      const project = await this.projectRepo.findOne({
        where: { id: projectId },
      });
      if (!project) return;
      const wasAlreadyBlocked = project.automationStatus === 'staffing_blocked';
      this.logger.error(`Staffing blocked for ${projectId}: ${reason}`);
      project.automationStatus = 'staffing_blocked';
      project.automationError = reason;
      project.automationErrorCategory = this.matchingFailureCategory(reason);
      project.automationErrorAt = new Date();
      await this.projectRepo.save(project);
      await this.incidents?.record({
        subsystem: 'matching',
        operation: 'staff_project',
        projectId,
        errorCode: project.automationErrorCategory ?? 'staffing_blocked',
        message: reason,
        context: { actionRequired: this.matchingFailureAction(reason) },
      });
      if (wasAlreadyBlocked) return;
      await this.notifyProjectOwner(
        project,
        'Automatic staffing needs attention',
        'We could not complete the next team invitation yet. Nexus AI will retry automatically; the project reviewer or operations team can view the exact blocker and intervene if needed.',
      );
    } catch (error) {
      this.logger.error(
        `Could not persist staffing blocker for ${projectId}: ${this.errorMessage(error)}`,
      );
    }
  }

  private async markWaitingForPrincipalReviewer(
    projectId: string,
    reason: string,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const project = await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOne();
      if (!project) return null;
      const reviewer = await manager.findOne(ProjectRoleAssignment, {
        where: {
          projectId,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(ASSIGNMENT_ACTIVE_STATUSES),
        },
      });
      const invitation = await manager.findOne(ProjectInvitation, {
        where: {
          projectId,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['pending', 'accepting']),
        },
      });
      // A losing concurrent matching attempt must not overwrite a successful
      // reservation/acceptance with WAITING_FOR_PR.
      if (reviewer || invitation) return null;
      const firstTransition = project.status !== ProjectStatus.WAITING_FOR_PR;
      if (firstTransition) {
        await this.transitionProject(manager, project, null, {
          status: ProjectStatus.WAITING_FOR_PR,
          planningStatus: 'waiting_for_pr',
          reason: 'No principal reviewer currently has available capacity.',
        });
      } else {
        project.planningStatus = 'waiting_for_pr';
      }
      project.automationStatus = 'waiting_for_pr';
      project.automationError = reason;
      project.automationErrorCategory = 'no_pr_capacity';
      project.automationErrorAt = new Date();
      await manager.save(Project, project);
      return { project, firstTransition };
    });
    if (!result) return;
    await this.incidents?.record({
      subsystem: 'matching',
      operation: 'staff_project',
      projectId,
      errorCode: 'no_pr_capacity',
      severity: 'warning',
      message: reason,
      context: { automaticallyRetrying: true },
    });
    if (result.firstTransition) {
      await this.notifyProjectOwner(
        result.project,
        'Waiting for a principal reviewer',
        'Your request is saved. Every qualified principal reviewer is currently at capacity, so no payment is required. We will continue automatically and notify you as soon as a reviewer accepts.',
      );
    }
  }

  private matchingFailureCategory(error: string | null | undefined) {
    if (!error) return null;
    const value = error.toLowerCase();
    if (
      /prerequisite|architecture|ui\/ux|brief|plan|not ready|must be approved/.test(
        value,
      )
    ) {
      return 'missing_prerequisite';
    }
    if (
      /no eligible|no suitable|no candidate|candidate remains|empty shortlist/.test(
        value,
      )
    ) {
      return 'no_eligible_freelancer';
    }
    if (/budget|rate|currency|allocation|compensation|escrow/.test(value)) {
      return 'budget_rate_mismatch';
    }
    if (
      /capacity|availability|unavailable|already assigned|workload/.test(value)
    ) {
      return 'availability_conflict';
    }
    if (
      /ai service|gemini|model|provider|temporarily unavailable/.test(value)
    ) {
      return 'ai_service';
    }
    if (
      /configuration|configured|token|credential|github|repository/.test(value)
    ) {
      return 'configuration';
    }
    return 'internal_error';
  }

  private matchingFailureAction(error: string | null | undefined) {
    const category = this.matchingFailureCategory(error);
    const actions: Record<string, string> = {
      missing_prerequisite:
        'Complete or approve the named prerequisite, then retry automation.',
      no_eligible_freelancer:
        'Review required skills/rate constraints or onboard another eligible freelancer; automatic retries continue.',
      budget_rate_mismatch:
        'Review the project allocation and freelancer rate currencies before retrying.',
      availability_conflict:
        'Wait for capacity or invite the next eligible candidate.',
      ai_service:
        'Check AI service health/model configuration, then retry the failed run.',
      configuration:
        'Fix the named integration or credential configuration, then retry.',
      internal_error:
        'Inspect the matching run details and service logs, then retry after resolving the error.',
    };
    return category ? actions[category] : null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private businessRoleLabel(roleKey: string) {
    const labels: Record<string, string> = {
      principal_reviewer: 'principal reviewer',
      ui_ux: 'UI/UX designer',
      architect: 'solution architect',
      implementation: 'implementation freelancer',
      frontend: 'frontend developer',
      backend: 'backend developer',
      fullstack: 'full-stack developer',
      qa: 'quality engineer',
    };
    return labels[staffingRoleBase(roleKey)] ?? roleKey.replaceAll('_', ' ');
  }

  private async createPlanningAssignment(
    manager: EntityManager,
    input: {
      run: MatchingRun;
      candidate: MatchingCandidate;
      adminUserId: string | null;
      notes: string | null;
      phase?: 'governance' | 'planning' | 'staffing';
      accepted?: boolean;
    },
  ): Promise<ProjectRoleAssignment> {
    const { run, candidate, adminUserId, notes } = input;
    const phase = input.phase ?? 'planning';
    const roleKey = run.targetRoleKey!;
    const project = await manager
      .getRepository(Project)
      .createQueryBuilder('project')
      .setLock('pessimistic_write')
      .where('project.id = :projectId', { projectId: run.projectId })
      .getOne();
    if (!project) throw new NotFoundException('Project not found');
    const profile = await manager
      .getRepository(FreelancerProfile)
      .createQueryBuilder('profile')
      .setLock('pessimistic_write')
      .where('profile.id = :profileId', {
        profileId: candidate.freelancerProfileId,
      })
      .getOne();
    if (
      !profile ||
      profile.verificationStatus !== 'approved' ||
      !profile.isAvailable
    ) {
      throw new ConflictException(
        'The selected freelancer is no longer approved and available',
      );
    }

    const conflictingRole = await manager.findOne(ProjectRoleAssignment, {
      where: {
        projectId: run.projectId,
        freelancerProfileId: profile.id,
        status: In(ASSIGNMENT_ACTIVE_STATUSES),
      },
    });
    if (conflictingRole) {
      throw new ConflictException(
        'One freelancer cannot hold multiple active roles on the same project',
      );
    }
    const conflictingTask = await manager.exists(ProjectTask, {
      where: {
        projectId: run.projectId,
        assignedFreelancerProfileId: profile.id,
      },
    });
    if (conflictingTask) {
      throw new ConflictException(
        'A principal or planning reviewer cannot review work they implemented on the same project',
      );
    }
    if (phase === 'governance') {
      if (
        profile.principalReviewerStatus !== 'approved' ||
        !profile.principalReviewerHourlyRate
      ) {
        throw new ConflictException(
          'The selected freelancer is not an approved principal reviewer',
        );
      }
      const activeProjects = await manager.count(ProjectRoleAssignment, {
        where: {
          freelancerProfileId: profile.id,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(ASSIGNMENT_ACTIVE_STATUSES),
        },
      });
      const capacity = Math.min(
        PRINCIPAL_REVIEWER_MAX_PROJECTS,
        Math.max(1, profile.principalReviewerMaxProjects),
      );
      if (activeProjects >= capacity) {
        throw new ConflictException(
          'The selected principal reviewer has reached their concurrent project limit',
        );
      }
    }
    const compensation =
      phase === 'governance'
        ? this.principalReviewerCompensation(project, profile)
        : phase === 'staffing'
          ? this.assertImplementationTeamCompensationCoverage(project)
          : this.assertPlanningCompensationCoverage(project, roleKey);

    const existing = await manager.findOne(ProjectRoleAssignment, {
      where: {
        projectId: run.projectId,
        phase,
        roleKey,
      },
    });
    if (existing && ASSIGNMENT_ACTIVE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        `An active ${roleKey} planning assignment already exists for this project`,
      );
    }

    return manager.save(
      ProjectRoleAssignment,
      manager.create(ProjectRoleAssignment, {
        projectId: run.projectId,
        freelancerProfileId: candidate.freelancerProfileId,
        phase,
        roleKey,
        status: input.accepted ? 'accepted' : 'assigned',
        sourceMatchingRunId: run.id,
        sourceCandidateId: candidate.id,
        assignedBy: adminUserId,
        hourlyRateSnapshot:
          phase === 'governance'
            ? profile.principalReviewerHourlyRate
            : profile.hourlyRate,
        budgetAmount: compensation.amount,
        currency: compensation.currency,
        estimatedHours: compensation.estimatedHours,
        availabilityHoursSnapshot: profile?.availabilityHoursPerWeek ?? null,
        scoreSnapshot: {
          matchingCandidateId: candidate.id,
          score: Number(candidate.score),
        },
        notes,
        assignedAt: new Date(),
        acceptedAt: input.accepted ? new Date() : null,
      }),
    );
  }

  private async maybeAdvanceToPlanningAssigned(
    manager: EntityManager,
    projectId: string,
    adminUserId: string | null,
  ) {
    const project = await manager
      .getRepository(Project)
      .createQueryBuilder('project')
      .setLock('pessimistic_write')
      .where('project.id = :projectId', { projectId })
      .getOne();
    if (!project) return false;
    if (!MATCH_START_ALLOWED_STATUSES.has(project.status)) return false;
    const activeRoles = await manager
      .createQueryBuilder(ProjectRoleAssignment, 'a')
      .select('DISTINCT a.role_key', 'roleKey')
      .where('a.project_id = :projectId', { projectId })
      .andWhere('a.phase IN (:...phases)', { phases: ['planning', 'staffing'] })
      .andWhere('a.status IN (:...statuses)', {
        statuses: ['accepted', 'in_progress'],
      })
      .getRawMany<{ roleKey: string }>();

    const roleSet = new Set(activeRoles.map((row) => row.roleKey));
    const requiredRoles = requiredPreFundingRoles();
    if (!requiredRoles.every((role) => roleSet.has(role))) return false;
    const reviewer = await manager.findOne(ProjectRoleAssignment, {
      where: {
        projectId,
        phase: 'governance',
        roleKey: PRINCIPAL_REVIEWER_ROLE,
        status: In(['accepted', 'in_progress']),
      },
    });
    if (!reviewer) return false;
    const pendingInvitation = await manager.exists(ProjectInvitation, {
      where: { projectId, status: In(['pending', 'accepting']) },
    });
    if (pendingInvitation) return false;
    if (project.status === ProjectStatus.READY_FOR_FUNDING) return false;

    const capacity = await this.estimateImplementationCapacity(project);
    project.implementationCapacitySnapshot = capacity;
    const capacityAtRisk = capacity.status === 'unavailable';
    if (capacityAtRisk) {
      project.automationStatus = 'ready_for_funding_capacity_at_risk';
      project.automationError = capacity.blockingReasons.join(' ');
      project.automationErrorCategory = 'implementation_capacity';
      project.automationErrorAt = new Date();
    }

    await this.transitionProject(manager, project, adminUserId, {
      status: ProjectStatus.READY_FOR_FUNDING,
      planningStatus: 'team_confirmed',
      reason: capacityAtRisk
        ? 'The planning team accepted; the project reached the funding screen but payment remains locked until the implementation-capacity sweep passes.'
        : 'The planning team accepted and estimated implementation capacity passed; planning funding is now enabled.',
      setAssignedAt: true,
    });
    if (!capacityAtRisk) {
      project.automationStatus = 'ready_for_funding';
      project.automationError = null;
      project.automationErrorCategory = null;
      project.automationErrorAt = null;
    }
    await manager.save(Project, project);
    return true;
  }

  private async estimateImplementationCapacity(project: Project) {
    const allocation = implementationTeamRoleAllocation(
      project.budgetAllocation,
    );
    const requiredPeople = Math.min(
      5,
      Math.max(1, Math.round(allocation?.people ?? 1)),
    );
    const minimumAvailability = this.minimumPlanningAvailability(
      project,
      'implementation_1',
    );
    const maxRate = Number(allocation?.maxHourlyRate);
    const currency = project.quotedCurrency ?? project.currency;
    const qb = this.buildProfileQuery({
      minAvailabilityHours: minimumAvailability,
    })
      .andWhere('p.hourlyRate IS NOT NULL')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM project_role_assignments capacity_assignment
          WHERE capacity_assignment.freelancer_profile_id = p.id
            AND capacity_assignment.project_id = :capacityProjectId
            AND capacity_assignment.status IN ('assigned', 'accepted', 'in_progress')
        )`,
        { capacityProjectId: project.id },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM project_tasks capacity_task
          WHERE capacity_task.assigned_freelancer_profile_id = p.id
            AND capacity_task.project_id = :capacityProjectId
            AND capacity_task.status NOT IN ('done', 'cancelled')
        )`,
        { capacityProjectId: project.id },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM project_invitations capacity_invitation
          WHERE capacity_invitation.freelancer_profile_id = p.id
            AND capacity_invitation.status IN ('pending', 'accepting')
        )`,
      )
      .orderBy('p.id', 'ASC');

    if (Number.isFinite(maxRate) && maxRate > 0) {
      const converted = rateInCurrencySql(
        'p.hourlyRate',
        'p.hourlyRateCurrency',
        currency,
        'capacityFx',
      );
      qb.andWhere(`${converted.sql} IS NOT NULL`);
      qb.andWhere(`${converted.sql} <= :capacityMaxRate`, {
        capacityMaxRate: maxRate,
        ...converted.params,
      });
    }

    const profiles = await qb.getMany();
    const workload = await this.getActiveWorkload(
      profiles.map((profile) => profile.id),
    );
    const workable = profiles.filter((profile) => {
      const activeTasks = workload.get(profile.id)?.tasks ?? 0;
      const declaredHours = Math.max(0, profile.availabilityHoursPerWeek ?? 0);
      const conservativeTaskCapacity = Math.max(
        1,
        Math.floor(declaredHours / 10),
      );
      return activeTasks < conservativeTaskCapacity;
    });
    const immediate = workable.filter(
      (profile) => (workload.get(profile.id)?.tasks ?? 0) === 0,
    );
    const brief = await this.briefRepo.findOne({
      where: { projectId: project.id },
    });
    const requiredSkills = (brief?.requiredSkills ?? '')
      .split(/[,;\n]/)
      .map((skill) => skill.trim())
      .filter(Boolean)
      .slice(0, 20);
    const coveredSkills = requiredSkills.filter((required) => {
      const normalized = required.toLowerCase();
      return workable.some((profile) =>
        (profile.skills ?? []).some((skill) => {
          const candidate = skill.toLowerCase();
          return (
            candidate.includes(normalized) || normalized.includes(candidate)
          );
        }),
      );
    });
    const blockingReasons: string[] = [];
    if (workable.length < requiredPeople) {
      blockingReasons.push(
        `The estimate needs ${requiredPeople} implementation freelancer(s), but only ${workable.length} currently satisfy approval, availability, workload, and budget checks.`,
      );
    }
    const skillsIncomplete =
      requiredSkills.length > 0 && coveredSkills.length < requiredSkills.length;
    const status =
      workable.length < requiredPeople
        ? 'unavailable'
        : workable.length < requiredPeople * 2 || skillsIncomplete
          ? 'at_risk'
          : 'viable';
    if (skillsIncomplete) {
      blockingReasons.push(
        `The current pool covers ${coveredSkills.length} of ${requiredSkills.length} estimated skill area(s); exact task matching may need more candidates.`,
      );
    }

    return {
      version: 1,
      status,
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      currency,
      requiredPeople,
      minimumAvailabilityHoursPerWeek: minimumAvailability,
      maximumCompatibleHourlyRate:
        Number.isFinite(maxRate) && maxRate > 0 ? maxRate : null,
      eligibleCandidates: profiles.length,
      workableCandidates: workable.length,
      immediatelyAvailableCandidates: immediate.length,
      requiredSkills,
      coveredSkills,
      blockingReasons,
      disclaimer:
        'This sweep gates planning payment but does not reserve freelancers. Exact invitations are sent only after the approved Scrum plan creates concrete tasks.',
    };
  }

  private async publishImplementationCapacityBlockIfNeeded(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (
      project?.automationStatus !== 'capacity_preflight_failed' ||
      project.implementationCapacitySnapshot?.status !== 'unavailable'
    ) {
      return;
    }
    await this.markStaffingBlocked(
      projectId,
      project.automationError ??
        'Estimated implementation capacity is currently unavailable.',
    );
  }

  private async transitionProject(
    manager: EntityManager,
    project: Project,
    adminUserId: string | null,
    change: {
      status: ProjectStatus;
      planningStatus?: string;
      reason: string;
      setPlanningStartedAt?: boolean;
      setAssignedAt?: boolean;
    },
  ) {
    const oldStatus = project.status;
    project.status = change.status;
    if (change.planningStatus) project.planningStatus = change.planningStatus;
    if (change.setPlanningStartedAt) {
      project.planningStartedAt = project.planningStartedAt ?? new Date();
    }
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
          changedBy: adminUserId,
          changedByType: adminUserId ? 'admin' : 'system',
          reason: change.reason,
        }),
      );
    }
  }

  private minimumPlanningAvailability(project: Project, roleKey: string) {
    const allocation =
      roleKey === PRINCIPAL_REVIEWER_ROLE
        ? principalReviewerRoleAllocation(project.budgetAllocation)
        : staffingRoleBase(roleKey) === 'implementation'
          ? implementationTeamRoleAllocation(project.budgetAllocation)
          : planningRoleAllocation(project.budgetAllocation, roleKey);
    if (!allocation?.estimatedHours) return 1;
    const remainingWeeks = project.deadline
      ? Math.max(
          1,
          (project.deadline.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000),
        )
      : 4;
    return Math.max(1, Math.ceil(allocation.estimatedHours / remainingWeeks));
  }

  private isProjectFullyFunded(project: Project) {
    const quote = Number(project.quotedAmount);
    const held = Number(project.heldAmount);
    return Boolean(
      Number.isFinite(quote) &&
      quote > 0 &&
      project.budgetAllocation &&
      Number.isFinite(held) &&
      held + 0.005 >= quote,
    );
  }

  private assertPlanningFunded(project: Project) {
    const funding = projectFundingBreakdown(project.budgetAllocation);
    const held = Number(project.heldAmount);
    const planningAmount = Number(funding?.planningAmount);
    if (!funding || !Number.isFinite(planningAmount) || planningAmount <= 0) {
      throw new ConflictException(
        'Project compensation is not allocated yet. Confirm the brief and generate a valid quote before matching.',
      );
    }
    if (!Number.isFinite(held) || held + 0.005 < planningAmount) {
      const remaining = Math.max(
        planningAmount - (Number.isFinite(held) ? held : 0),
        0,
      );
      throw new ConflictException(
        `Exact implementation matching requires the paid planning package. Fund the remaining ${remaining.toFixed(2)} ${project.quotedCurrency ?? project.currency} planning balance first.`,
      );
    }
  }

  private assertProjectReadyForStaffing(project: Project) {
    const quote = Number(project.quotedAmount);
    if (
      !Number.isFinite(quote) ||
      quote <= 0 ||
      !project.budgetAllocation ||
      project.quoteStatus === 'not_ready' ||
      project.quoteStatus === 'out_of_budget'
    ) {
      throw new ConflictException(
        'Confirm a feasible fixed project quote before team matching starts.',
      );
    }
  }

  private assertPlanningCompensationCoverage(
    project: Project,
    roleKey: string,
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
    const amount = Number(allocation.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictException(
        `The ${roleKey} fixed-package offer is invalid`,
      );
    }
    return {
      amount: allocation.amount,
      currency: project.quotedCurrency ?? project.currency,
      estimatedHours: allocation.estimatedHours,
    };
  }

  private assertImplementationTeamCompensationCoverage(project: Project) {
    const allocation = implementationTeamRoleAllocation(
      project.budgetAllocation,
    );
    if (!allocation) {
      throw new ConflictException(
        'No implementation-team package allocation exists for this project',
      );
    }
    const amount = Number(allocation.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictException(
        'The implementation fixed-package offer is invalid',
      );
    }
    return {
      amount: allocation.amount,
      currency: project.quotedCurrency ?? project.currency,
      estimatedHours: allocation.estimatedHours,
    };
  }

  private principalReviewerCompensation(
    project: Project,
    profile: FreelancerProfile,
  ) {
    const allocation = principalReviewerRoleAllocation(
      project.budgetAllocation,
    );
    const total = Number(project.quotedAmount);
    const estimatedHours = allocation?.estimatedHours ?? 12;
    const amount = Number(allocation?.amount ?? total * 0.1);
    const rate = Number(profile.principalReviewerHourlyRate);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConflictException(
        'No principal-reviewer compensation is allocated for this project',
      );
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new ConflictException(
        'The principal reviewer must have an approved reviewer-specific hourly rate',
      );
    }
    return {
      amount: amount.toFixed(2),
      currency: project.quotedCurrency ?? project.currency,
      estimatedHours,
    };
  }

  private assertTaskCompensationCoverage(task: ProjectTask) {
    const amount = Number(task.budgetAmount);
    const hours = Number(task.estimatedHours);
    if (
      !task.currency ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(hours) ||
      hours <= 0
    ) {
      throw new ConflictException(
        'Task compensation and estimated hours must be allocated before assignment',
      );
    }
    // The freelancer is accepting a fixed task package. Their assessed hourly
    // rate remains a ranking/rate-fit signal, but multiplying it by estimated
    // hours must not silently rewrite or reject the agreed package offer.
  }

  // Approved, available freelancers, narrowed by the admin's explicit filters.
  private buildProfileQuery(filters?: PlanningMatchingFiltersDto) {
    const qb = this.profileRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.skillScores', 's')
      .leftJoinAndSelect('p.user', 'u')
      .where('p.verificationStatus = :approved', { approved: 'approved' })
      .andWhere('p.deletedAt IS NULL')
      .andWhere('p.isAvailable = true');

    if (filters?.minAvailabilityHours != null) {
      qb.andWhere('COALESCE(p.availabilityHoursPerWeek, 0) >= :minAvail', {
        minAvail: filters.minAvailabilityHours,
      });
    }
    if (filters?.includeFreelancerIds?.length) {
      qb.andWhere('p.id IN (:...include)', {
        include: filters.includeFreelancerIds,
      });
    }
    if (filters?.excludeFreelancerIds?.length) {
      qb.andWhere('p.id NOT IN (:...exclude)', {
        exclude: filters.excludeFreelancerIds,
      });
    }
    return qb;
  }

  /**
   * Works out which filter emptied the candidate pool, so the error names the
   * real blocker instead of always blaming skills, rate and availability.
   * Only runs when matching has already failed, so the extra queries are cheap.
   */
  private async explainEmptyCandidatePool(
    roleKey: string,
    project: Project,
    maxRate: number | null,
    minimumAvailability: number,
  ): Promise<string> {
    const currency = project.quotedCurrency ?? project.currency ?? '';
    const rateLabel =
      maxRate != null ? `${maxRate.toFixed(2)} ${currency}/hour`.trim() : null;

    const count = async (where: string, params: Record<string, unknown> = {}) =>
      this.profileRepo.createQueryBuilder('p').where(where, params).getCount();

    const approved = await count(
      "p.verificationStatus = 'approved' AND p.deletedAt IS NULL",
    );
    if (!approved) {
      return `No approved freelancer exists yet, so ${roleKey} cannot be staffed. Approve at least one freelancer before matching.`;
    }

    const available = await count(
      "p.verificationStatus = 'approved' AND p.deletedAt IS NULL AND p.isAvailable = true",
    );
    if (!available) {
      return `All ${approved} approved freelancer(s) are marked unavailable, so ${roleKey} cannot be staffed.`;
    }

    const withHours = await count(
      "p.verificationStatus = 'approved' AND p.deletedAt IS NULL AND p.isAvailable = true AND COALESCE(p.availabilityHoursPerWeek, 0) >= :hours",
      { hours: minimumAvailability },
    );
    if (!withHours) {
      return `None of the ${available} eligible freelancer(s) has the ${minimumAvailability} availability hours/week this ${roleKey} role needs.`;
    }

    if (roleKey === PRINCIPAL_REVIEWER_ROLE) {
      const approvedReviewers = await count(
        "p.verificationStatus = 'approved' AND p.deletedAt IS NULL AND p.isAvailable = true AND p.principalReviewerStatus = 'approved' AND p.principalReviewerHourlyRate IS NOT NULL",
      );
      if (!approvedReviewers) {
        return `No freelancer is an approved principal reviewer with a principal-reviewer rate set, so ${roleKey} cannot be staffed.`;
      }
      return `All ${approvedReviewers} approved principal reviewer(s) are excluded — they are already at their concurrent-project limit, are already on this project, or their principal-reviewer rate exceeds${rateLabel ? ` the allocated maximum of ${rateLabel}` : ' the allocated maximum'}. Free up a reviewer or approve another one.`;
    }

    if (rateLabel) {
      const converted = rateInCurrencySql(
        'p.hourlyRate',
        'p.hourlyRateCurrency',
        project.quotedCurrency ?? project.currency,
        'candidateDiagnosisFx',
      );
      const withinRate = await this.profileRepo
        .createQueryBuilder('p')
        .where(
          "p.verificationStatus = 'approved' AND p.deletedAt IS NULL AND p.isAvailable = true",
        )
        .andWhere(
          'COALESCE(p.availabilityHoursPerWeek, 0) >= :diagnosisHours',
          { diagnosisHours: minimumAvailability },
        )
        .andWhere('p.hourlyRate IS NOT NULL')
        .andWhere(`${converted.sql} IS NOT NULL`)
        .andWhere(`${converted.sql} <= :diagnosisRate`, {
          diagnosisRate: maxRate,
          ...converted.params,
        })
        .getCount();
      if (!withinRate) {
        return `None of the ${withHours} eligible freelancer(s) charges within the allocated maximum of ${rateLabel}. Increase the budget or lower the rate expectation for ${roleKey}.`;
      }
    }

    return `No ${roleKey} freelancer is selectable: every otherwise-eligible profile is already assigned to this project or holds a task on it.`;
  }

  /**
   * Explains which filter emptied an implementation task's candidate pool.
   * The old message blamed skills, rate and availability regardless of cause —
   * the same defect #19 fixed for planning roles, left behind on this path.
   */
  private async explainEmptyTaskPool(
    task: ProjectTask,
    project: Project,
    maxRate: number | null,
  ): Promise<string> {
    const currency = project.quotedCurrency ?? project.currency ?? '';
    const rateLabel =
      maxRate != null ? `${maxRate.toFixed(2)} ${currency}`.trim() : null;

    const count = async (where: string, params: Record<string, unknown> = {}) =>
      this.profileRepo.createQueryBuilder('p').where(where, params).getCount();

    const base =
      "p.verificationStatus = 'approved' AND p.deletedAt IS NULL AND p.isAvailable = true";

    const eligible = await count(base);
    if (!eligible) {
      return `No approved, available freelancer exists, so "${task.title}" cannot be staffed.`;
    }

    const free = await count(
      `${base} AND NOT EXISTS (
         SELECT 1 FROM project_role_assignments a
         WHERE a.freelancer_profile_id = p.id AND a.project_id = :projectId
           AND a.status IN ('assigned','accepted','in_progress')
       )`,
      { projectId: project.id },
    );
    if (!free) {
      return `All ${eligible} eligible freelancer(s) already hold a role on this project, so nobody is free for "${task.title}". Add another approved freelancer.`;
    }

    if (rateLabel) {
      const converted = rateInCurrencySql(
        'p.hourlyRate',
        'p.hourlyRateCurrency',
        project.quotedCurrency ?? project.currency,
        'taskDiagnosisFx',
      );
      const affordable = await this.profileRepo
        .createQueryBuilder('p')
        .where(base)
        .andWhere('p.hourlyRate IS NOT NULL')
        .andWhere(`${converted.sql} IS NOT NULL`)
        .andWhere(`${converted.sql} <= :diagnosisRate`, {
          diagnosisRate: maxRate,
          ...converted.params,
        })
        .getCount();
      if (!affordable) {
        return `No eligible freelancer charges within the ${rateLabel}/hour allocated to "${task.title}". Increase the task budget.`;
      }
    }

    return `No freelancer satisfies every requirement for "${task.title}" at once — skills, the ${rateLabel ?? 'allocated'} rate, availability, and not already holding a role on this project.`;
  }

  private async buildCandidatePool(
    dto: StartPlanningMatchingDto,
    brief: Brief | null,
    project: Project,
    roleKey: string,
  ) {
    const filters = dto.filters;
    const qb = this.buildProfileQuery(filters);

    // Rate is a ranking signal for fixed-package work. Only an explicit admin
    // override is a hard cap; the package is not reconstructed as hours × rate.
    const maxRate = filters?.maxHourlyRate ?? null;
    const cappedQb = qb.clone();
    cappedQb.andWhere(
      `NOT EXISTS (
        SELECT 1 FROM project_role_assignments existing_assignment
        WHERE existing_assignment.freelancer_profile_id = p.id
          AND existing_assignment.project_id = :candidateProjectId
          AND existing_assignment.status IN ('assigned', 'accepted', 'in_progress')
      )`,
      { candidateProjectId: project.id },
    );
    cappedQb.andWhere(
      `NOT EXISTS (
        SELECT 1 FROM project_tasks existing_task
        WHERE existing_task.assigned_freelancer_profile_id = p.id
          AND existing_task.project_id = :candidateProjectId
      )`,
      { candidateProjectId: project.id },
    );
    const rateColumn =
      roleKey === PRINCIPAL_REVIEWER_ROLE
        ? 'p.principalReviewerHourlyRate'
        : 'p.hourlyRate';
    if (roleKey === PRINCIPAL_REVIEWER_ROLE) {
      cappedQb.andWhere('p.principalReviewerStatus = :reviewerApproved', {
        reviewerApproved: 'approved',
      });
      cappedQb.andWhere('p.principalReviewerHourlyRate IS NOT NULL');
      cappedQb.andWhere(
        'COALESCE(p.performanceScore, 100) >= :reviewerMinPerformance',
        {
          reviewerMinPerformance: PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE,
        },
      );
      cappedQb.andWhere(
        // Only assignments on live projects count against capacity. Projects are
        // soft-deleted, so without the deleted_at check a deleted project holds
        // a reviewer slot forever and silently locks matching out. ISSUES.md #20.
        `(
          SELECT COUNT(DISTINCT reviewer_assignment.project_id)
          FROM project_role_assignments reviewer_assignment
          INNER JOIN projects reviewer_project
            ON reviewer_project.id = reviewer_assignment.project_id
           AND reviewer_project.deleted_at IS NULL
          WHERE reviewer_assignment.freelancer_profile_id = p.id
            AND reviewer_assignment.phase = 'governance'
            AND reviewer_assignment.role_key = :principalReviewerRole
            AND reviewer_assignment.status IN ('assigned', 'accepted', 'in_progress')
        ) < LEAST(:reviewerMaxProjects, GREATEST(1, p.principalReviewerMaxProjects))`,
        {
          principalReviewerRole: PRINCIPAL_REVIEWER_ROLE,
          reviewerMaxProjects: PRINCIPAL_REVIEWER_MAX_PROJECTS,
        },
      );
    }
    const minimumAvailability = Math.max(
      filters?.minAvailabilityHours ?? 0,
      this.minimumPlanningAvailability(project, roleKey),
    );
    cappedQb.andWhere(
      'COALESCE(p.availabilityHoursPerWeek, 0) >= :roleMinAvailability',
      { roleMinAvailability: minimumAvailability },
    );
    if (maxRate != null) {
      // The cap is in the project's currency; the freelancer's rate is in
      // theirs. Compare them in one unit instead of as bare numbers.
      // See ISSUES.md #9.
      const capCurrency = project.quotedCurrency ?? project.currency;
      const converted = rateInCurrencySql(
        rateColumn,
        'p.hourlyRateCurrency',
        capCurrency,
      );
      cappedQb.andWhere(`${rateColumn} IS NOT NULL`);
      cappedQb.andWhere(`${converted.sql} IS NOT NULL`);
      cappedQb.andWhere(`${converted.sql} <= :maxRate`, {
        maxRate,
        ...converted.params,
      });
    }

    const poolCap = filters?.limit ? Math.min(filters.limit * 4, 100) : 60;
    const fetchedProfiles = await cappedQb.take(poolCap).getMany();
    const requiredRoleSkills = PLANNING_ROLE_SKILLS[roleKey] ?? [];
    // Skills are a ranking signal, not a hard gate. This preserves exact
    // matches at the top while still allowing strong adjacent-skill and lower
    // acceptable candidates to act as invitation fallbacks.
    const profiles = [...fetchedProfiles].sort((left, right) => {
      const overlap = (profile: FreelancerProfile) => {
        const skills = (profile.skills ?? []).map((skill) =>
          skill.toLowerCase(),
        );
        return requiredRoleSkills.filter((required) => {
          const normalized = required.toLowerCase();
          return skills.some(
            (skill) => skill.includes(normalized) || normalized.includes(skill),
          );
        }).length;
      };
      return overlap(right) - overlap(left);
    });

    if (!profiles.length) {
      // The old message named skills, rate and availability whatever the real
      // cause was, and sent people hunting in the wrong place — the actual
      // blocker was usually reviewer capacity or a missing GitHub username.
      // Report which filter actually emptied the pool. ISSUES.md #19.
      throw new ConflictException(
        await this.explainEmptyCandidatePool(
          roleKey,
          project,
          maxRate,
          minimumAvailability,
        ),
      );
    }

    // Dense retrieval signal: cosine of the brief embedding vs. each freelancer
    // profile embedding (pgvector). Best-effort — if it fails, matching still
    // works on lexical + structured signals.
    const profileIds = profiles.map((profile) => profile.id);
    const [similarity, workload] = await Promise.all([
      this.computeTextSimilarity(this.briefText(brief), profileIds),
      this.getActiveWorkload(profileIds),
    ]);

    return {
      candidates: this.toCandidateInputs(
        profiles,
        similarity,
        workload,
        roleKey,
      ),
    };
  }

  // Same idea as the planning pool, but narrowed to one implementation task.
  // The fixed task allocation supplies a compatibility rate cap; skills remain
  // ranking evidence so strong adjacent candidates can serve as fallbacks.
  private async buildTaskCandidatePool(
    task: ProjectTask,
    filters: PlanningMatchingFiltersDto | undefined,
    maxRate: number | null,
  ): Promise<MatchCandidateInputDto[]> {
    const project = await this.projectRepo.findOne({
      where: { id: task.projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const qb = this.buildProfileQuery(filters);

    const narrowedQb = qb.clone();
    narrowedQb.andWhere(
      `NOT EXISTS (
        SELECT 1 FROM project_role_assignments reviewer_assignment
        WHERE reviewer_assignment.freelancer_profile_id = p.id
          AND reviewer_assignment.project_id = :taskProjectId
          AND reviewer_assignment.phase = 'governance'
          AND reviewer_assignment.role_key = :principalReviewerRole
          AND reviewer_assignment.status IN ('assigned', 'accepted', 'in_progress')
      )`,
      {
        taskProjectId: task.projectId,
        principalReviewerRole: PRINCIPAL_REVIEWER_ROLE,
      },
    );
    if (maxRate != null) {
      // Convert before comparing — the cap is in the project's currency and the
      // freelancer's rate is in theirs. The planning path already did this; this
      // task path was still comparing bare numbers. See ISSUES.md #9.
      const taskCapCurrency = project.quotedCurrency ?? project.currency;
      const taskConverted = rateInCurrencySql(
        'p.hourlyRate',
        'p.hourlyRateCurrency',
        taskCapCurrency,
        'taskfx',
      );
      narrowedQb.andWhere('p.hourlyRate IS NOT NULL');
      narrowedQb.andWhere(`${taskConverted.sql} IS NOT NULL`);
      narrowedQb.andWhere(`${taskConverted.sql} <= :maxRate`, {
        maxRate,
        ...taskConverted.params,
      });
    }
    // Do not hard-filter by exact skills. The reranker scores exact, strong and
    // acceptable related-skill candidates and keeps the latter as fallbacks.

    const poolCap = filters?.limit ? Math.min(filters.limit * 4, 100) : 60;
    const profiles = await narrowedQb.take(poolCap).getMany();
    if (!profiles.length) {
      // Name the filter that actually emptied the pool. This path kept the old
      // blame-everything message after #19 fixed the planning path.
      throw new ConflictException(
        await this.explainEmptyTaskPool(task, project, maxRate),
      );
    }

    const profileIds = profiles.map((profile) => profile.id);
    const [similarity, workload] = await Promise.all([
      this.computeTextSimilarity(this.taskText(task), profileIds),
      this.getActiveWorkload(profileIds),
    ]);

    return this.toCandidateInputs(profiles, similarity, workload);
  }

  private toCandidateInputs(
    profiles: FreelancerProfile[],
    similarity: Map<string, number>,
    workload?: Map<string, { tasks: number; projects: number }>,
    roleKey?: string,
  ): MatchCandidateInputDto[] {
    return profiles.map((profile) => {
      const scores = (profile.skillScores ?? []).map((entry) => ({
        skill: entry.skill,
        score: Number(entry.score),
      }));
      const averageSkillScore = scores.length
        ? Number(
            (
              scores.reduce((sum, entry) => sum + entry.score, 0) /
              scores.length
            ).toFixed(2),
          )
        : null;
      const active = workload?.get(profile.id);
      const reviewedSubmissions =
        profile.approvedSubmissions + profile.rejectedSubmissions;
      const timedDeliveries = profile.onTimeDeliveries + profile.lateDeliveries;

      return {
        freelancerProfileId: profile.id,
        name: this.fullName(profile.user) ?? undefined,
        headline: profile.headline ?? undefined,
        profileSummary: profile.bio ?? undefined,
        skills: profile.skills ?? [],
        skillScores: scores,
        hourlyRate:
          roleKey === PRINCIPAL_REVIEWER_ROLE
            ? profile.principalReviewerHourlyRate != null
              ? Number(profile.principalReviewerHourlyRate)
              : null
            : profile.hourlyRate != null
              ? Number(profile.hourlyRate)
              : null,
        availabilityHours: profile.availabilityHoursPerWeek ?? null,
        yearsExperience: profile.yearsExperience ?? null,
        averageSkillScore,
        embeddingSimilarity: similarity.get(profile.id) ?? null,
        performanceScore: Number(profile.performanceScore ?? 100),
        approvalRate: reviewedSubmissions
          ? profile.approvedSubmissions / reviewedSubmissions
          : null,
        onTimeRate: timedDeliveries
          ? profile.onTimeDeliveries / timedDeliveries
          : null,
        missedDeadlines: profile.missedDeadlines ?? 0,
        projectRemovals: profile.projectRemovals ?? 0,
        riskFlags: profile.riskFlags ?? [],
        ...(workload
          ? {
              activeTaskCount: active?.tasks ?? 0,
              activeProjectCount: active?.projects ?? 0,
            }
          : {}),
      };
    });
  }

  // How much open implementation work each candidate already carries. Passed to
  // the reranker as a signal; it does not remove anyone from the pool.
  private async getActiveWorkload(profileIds: string[]) {
    const map = new Map<string, { tasks: number; projects: number }>();
    if (!profileIds.length) return map;

    const rows = await this.taskRepo
      .createQueryBuilder('t')
      .select('t.assigned_freelancer_profile_id', 'profileId')
      .addSelect('COUNT(*)', 'tasks')
      .addSelect('COUNT(DISTINCT t.project_id)', 'projects')
      .where('t.assigned_freelancer_profile_id IN (:...profileIds)', {
        profileIds,
      })
      .andWhere('t.status IN (:...statuses)', {
        statuses: ACTIVE_TASK_STATUSES,
      })
      .groupBy('t.assigned_freelancer_profile_id')
      .getRawMany<{ profileId: string; tasks: string; projects: string }>();

    for (const row of rows) {
      map.set(row.profileId, {
        tasks: Number(row.tasks),
        projects: Number(row.projects),
      });
    }
    return map;
  }

  // Tasks that may be matched now: unassigned, in a matchable status, and not
  // already covered by an in-flight run.
  private async resolveMatchableTasks(
    projectId: string,
    dto: StartImplementationMatchingDto,
  ) {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.project_id = :projectId', { projectId })
      .andWhere('t.assigned_freelancer_profile_id IS NULL')
      .andWhere('t.status IN (:...statuses)', {
        statuses: MATCHABLE_TASK_STATUSES,
      })
      .orderBy('t.order_index', 'ASC');

    if (dto.taskIds?.length) {
      qb.andWhere('t.id IN (:...taskIds)', { taskIds: dto.taskIds });
    } else if (dto.milestoneId) {
      qb.andWhere('t.milestone_id = :milestoneId', {
        milestoneId: dto.milestoneId,
      });
    }
    const tasks = await qb.getMany();
    if (!tasks.length) return tasks;

    // Naming tasks explicitly is a deliberate rerun, so only a run that is still
    // in flight blocks it. The bulk path also skips already-ranked tasks.
    const blockingStatuses = dto.taskIds?.length
      ? ['queued', 'running']
      : ['queued', 'running', 'completed'];
    const rows = await this.runRepo
      .createQueryBuilder('r')
      .select('r.target_task_id', 'taskId')
      .where('r.project_id = :projectId', { projectId })
      .andWhere('r.target_type = :targetType', { targetType: 'task' })
      .andWhere('r.target_task_id IS NOT NULL')
      .andWhere('r.status IN (:...statuses)', { statuses: blockingStatuses })
      .getRawMany<{ taskId: string }>();

    const busy = new Set(rows.map((row) => row.taskId));
    return tasks.filter((task) => !busy.has(task.id));
  }

  private assertTaskMatchingRun(run: MatchingRun, task: ProjectTask) {
    assertTaskMatchingRunInvariant(run, task);
  }

  private async recoverStaleImplementationRuns(projectId: string) {
    const result = await this.runRepo
      .createQueryBuilder()
      .update(MatchingRun)
      .set({
        status: 'failed',
        error: 'Matching was interrupted before completion and can be retried.',
      })
      .where('project_id = :projectId', { projectId })
      .andWhere('target_type = :targetType', { targetType: 'task' })
      .andWhere("status IN ('queued', 'running')")
      .andWhere("updated_at < NOW() - INTERVAL '2 hours'")
      .execute();
    if (result.affected) {
      this.logger.warn(
        `Recovered ${result.affected} stale implementation matching run(s) for project ${projectId}`,
      );
    }
  }

  private briefText(brief: Brief | null) {
    if (!brief) return null;
    return (
      [brief.summary, brief.briefText]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join('\n')
        .trim() || null
    );
  }

  private taskText(task: ProjectTask) {
    return (
      [task.title, task.description, (task.requiredSkills ?? []).join(', ')]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join('\n')
        .trim() || null
    );
  }

  /**
   * Cosine similarity of the given text's embedding vs. each freelancer profile
   * embedding, via pgvector. Returns an empty map (lexical-only fallback) if
   * there is no text, the embedding call fails, or no profile has an embedding.
   */
  private async computeTextSimilarity(
    text: string | null,
    profileIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!text || !profileIds.length) return map;

    try {
      const result = await this.aiService.generateEmbedding({
        text,
        dimensions: 1024,
      });
      const embedding = result.embedding;
      if (!embedding?.length) return map;

      const vectorLiteral = `[${embedding.join(',')}]`;
      const rows = await this.dataSource.query<
        { freelancer_profile_id: string; similarity: string }[]
      >(
        `SELECT DISTINCT ON (freelancer_profile_id)
                freelancer_profile_id,
                1 - (embedding <=> $1::vector) AS similarity
         FROM freelancer_profile_embeddings
         WHERE freelancer_profile_id = ANY($2::uuid[])
         ORDER BY freelancer_profile_id, created_at DESC`,
        [vectorLiteral, profileIds],
      );

      for (const row of rows) {
        map.set(row.freelancer_profile_id, Number(row.similarity));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Brief similarity unavailable; matching falls back to lexical relevance: ${message}`,
      );
    }
    return map;
  }

  private buildProjectSnapshot(project: Project, requiredSkills: string[]) {
    return {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      budgetMin: Number(project.budgetMin),
      budgetMax: Number(project.budgetMax),
      currency: project.currency,
      deadline: project.deadline?.toISOString() ?? null,
      isDeadlineFlexible: project.isDeadlineFlexible,
      requiredSkills,
    };
  }

  private buildTaskSnapshot(task: ProjectTask, requiredSkills: string[]) {
    const criteria = task.acceptanceCriteria;
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      roleKey: task.roleKey,
      requiredSkills,
      estimatedHours:
        task.estimatedHours != null ? Number(task.estimatedHours) : null,
      acceptanceCriteria: Array.isArray(criteria) ? criteria : [],
      milestoneId: task.milestoneId,
    };
  }

  private buildBriefSnapshot(brief: Brief | null) {
    if (!brief) return null;
    return {
      id: brief.id,
      summary: brief.summary,
      briefText: brief.briefText,
      requiredSkills: brief.requiredSkills,
      technical: brief.technical,
    };
  }

  private async getProject(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async assertPrincipalReviewerAssigned(projectId: string) {
    const assignment = await this.dataSource
      .getRepository(ProjectRoleAssignment)
      .findOne({
        where: {
          projectId,
          phase: 'governance',
          roleKey: PRINCIPAL_REVIEWER_ROLE,
          status: In(['accepted', 'in_progress']),
        },
        select: { id: true },
      });
    if (!assignment) {
      throw new ConflictException(
        'A principal reviewer must accept the project before team matching can start',
      );
    }
  }

  private async getCandidateCounts(runIds: string[]) {
    const counts = new Map<string, number>();
    if (!runIds.length) return counts;

    const rows = await this.candidateRepo
      .createQueryBuilder('c')
      .select('c.matching_run_id', 'runId')
      .addSelect('COUNT(*)', 'count')
      .where('c.matching_run_id IN (:...runIds)', { runIds })
      .groupBy('c.matching_run_id')
      .getRawMany<{ runId: string; count: string }>();

    for (const row of rows) counts.set(row.runId, Number(row.count));
    return counts;
  }

  private async getSelectedCandidateIds(runIds: string[]) {
    const selected = new Map<string, string>();
    if (!runIds.length) return selected;

    const rows = await this.candidateRepo.find({
      where: runIds.map((runId) => ({ matchingRunId: runId })),
    });
    for (const row of rows) {
      if (
        row.status === 'selected' ||
        row.status === 'invited' ||
        row.status === 'assigned'
      ) {
        selected.set(row.matchingRunId, row.id);
      }
    }
    return selected;
  }

  private async getLatestInvitations(runIds: string[]) {
    const invitations = new Map<
      string,
      ReturnType<typeof this.buildInvitationSummary>
    >();
    if (!runIds.length) return invitations;

    const rows = await this.invitationRepo.find({
      where: { matchingRunId: In(runIds) },
      order: { createdAt: 'DESC' },
    });
    for (const row of rows) {
      if (row.matchingRunId && !invitations.has(row.matchingRunId)) {
        invitations.set(row.matchingRunId, this.buildInvitationSummary(row));
      }
    }
    return invitations;
  }

  private buildInvitationSummary(invitation: ProjectInvitation) {
    return {
      id: invitation.id,
      candidateId: invitation.candidateId,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      respondedAt: invitation.respondedAt,
      responseReason: invitation.responseReason,
    };
  }

  private buildFreelancerSummary(profile: FreelancerProfile | null) {
    if (!profile) return null;
    return {
      id: profile.id,
      name: this.fullName(profile.user),
      email: profile.user?.email ?? null,
      headline: profile.headline,
      bio: profile.bio,
      summary: profile.summary,
      githubUsername: profile.githubUsername,
      cvUrl: profile.cvUrl,
      hourlyRate:
        profile.hourlyRate != null ? Number(profile.hourlyRate) : null,
      // Without the unit a reviewer sees "Rate: 40 / hour" and cannot tell
      // whether that is dollars or pounds. ISSUES.md #9 / #24.
      hourlyRateCurrency: profile.hourlyRateCurrency ?? null,
      recommendedHourlyRate:
        profile.recommendedHourlyRate != null
          ? Number(profile.recommendedHourlyRate)
          : null,
      availabilityHours: profile.availabilityHoursPerWeek,
      yearsExperience: profile.yearsExperience,
      topSkills: profile.skills ?? [],
      assessmentScore:
        profile.assessmentScore != null
          ? Number(profile.assessmentScore)
          : null,
      interviewScore:
        profile.interviewScore != null ? Number(profile.interviewScore) : null,
      performanceScore: Number(profile.performanceScore ?? 100),
      avgRating: profile.avgRating != null ? Number(profile.avgRating) : null,
      ratingsCount: profile.ratingsCount,
      completedTasks: profile.completedTasks,
      approvedSubmissions: profile.approvedSubmissions,
      rejectedSubmissions: profile.rejectedSubmissions,
      onTimeDeliveries: profile.onTimeDeliveries,
      lateDeliveries: profile.lateDeliveries,
      missedDeadlines: profile.missedDeadlines,
      projectRemovals: profile.projectRemovals,
      riskFlags: profile.riskFlags ?? [],
      isAvailable: profile.isAvailable,
      verificationStatus: profile.verificationStatus,
    };
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }

  private errorMessage(error: unknown) {
    if (error instanceof ForbiddenException) throw error;
    return error instanceof Error ? error.message : String(error);
  }

  private safeErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
