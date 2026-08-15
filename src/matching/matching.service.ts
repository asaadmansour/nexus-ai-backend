import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
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

const PLANNING_ROLES = ['architect', 'ui_ux'];
const DEFAULT_LIMIT = 10;

// Budget-aware rate cap for planning matching. The project budget is a total
// lump sum, so we convert it into an affordable hourly rate: planning takes a
// share of the budget, split across the planning roles, over a rough per-role
// effort. These are tunable product assumptions.
const PLANNING_BUDGET_SHARE = 0.2; // planning ≈ 20% of the total project budget
const PLANNING_HOURS_PER_ROLE = 40; // a planning deliverable ≈ one focused week
const MIN_AFFORDABLE_POOL = 3; // below this, relax the cap so the pool isn't empty

// Sensible default required-skills per planning role, used when the admin does
// not pass explicit `filters.skills`. Lets the architect and ui_ux runs rank
// against role-relevant skills instead of one shared list.
const PLANNING_ROLE_SKILLS: Record<string, string[]> = {
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
};
const MATCH_START_ALLOWED_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.BRIEF_COMPLETE,
  ProjectStatus.PLANNING_MATCHING,
]);
const ASSIGNMENT_ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress'];

// --- Implementation-task matching -------------------------------------------

// Implementation work takes the rest of the budget after planning. As with
// planning, the lump sum is turned into an affordable hourly rate, here using
// the total estimated hours of the project's implementation tasks.
const IMPLEMENTATION_BUDGET_SHARE = 0.7;

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

const IMPLEMENTATION_MATCH_ALLOWED_STATUSES = new Set<ProjectStatus>([
  ProjectStatus.IMPLEMENTATION_READY,
  ProjectStatus.MATCHING,
  ProjectStatus.MATCHED,
  ProjectStatus.ASSIGNED,
  ProjectStatus.ACTIVE,
  ProjectStatus.UNDER_REVIEW,
]);

const ASSIGNABLE_CANDIDATE_STATUSES = new Set([
  'recommended',
  'shortlisted',
  'selected',
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
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Start planning-role matching
  // ---------------------------------------------------------------------------

  // Automatically triggered when a project's brief becomes complete. No-ops if
  // matching already ran or the project is not startable, and never throws — it
  // must not disrupt the brief-completion flow that calls it.
  async autoStartPlanningRoles(projectId: string): Promise<void> {
    try {
      const existingRuns = await this.runRepo.count({ where: { projectId } });
      if (existingRuns > 0) return;

      const project = await this.projectRepo.findOne({
        where: { id: projectId },
      });
      if (!project || project.status !== ProjectStatus.BRIEF_COMPLETE) return;

      await this.startPlanningRoles(projectId, {}, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auto-start matching failed for project ${projectId}: ${message}`,
      );
    }
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

    const roles = dto.roles?.length
      ? Array.from(new Set(dto.roles))
      : [...PLANNING_ROLES];

    const brief = await this.briefRepo.findOne({ where: { projectId } });
    const { candidates } = await this.buildCandidatePool(dto, brief, project);
    const limit = dto.filters?.limit ?? DEFAULT_LIMIT;

    // Create the runs and flip the project up front, in a short transaction, so
    // the (potentially slow) AI calls do not hold a DB transaction open.
    const runs = await this.dataSource.transaction(async (manager) => {
      const created: MatchingRun[] = [];
      for (const role of roles) {
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
                candidatePoolSize: candidates.length,
                filters: dto.filters ?? null,
              },
              startedAt: new Date(),
            }),
          ),
        );
      }
      await this.transitionProject(manager, project, adminUserId, {
        status: ProjectStatus.PLANNING_MATCHING,
        planningStatus: 'matching',
        reason: 'Started planning-role matching.',
        setPlanningStartedAt: true,
      });
      return created;
    });

    const briefSnapshot = this.buildBriefSnapshot(brief);
    const runResults: Record<string, unknown>[] = [];

    for (const run of runs) {
      try {
        // Rank against role-specific skills (admin override, else per-role default).
        const roleSkills = dto.filters?.skills?.length
          ? dto.filters.skills
          : (PLANNING_ROLE_SKILLS[run.targetRoleKey!] ?? []);
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
        runResults.push({
          id: run.id,
          targetType: 'planning_role',
          targetRoleKey: run.targetRoleKey,
          status: 'completed',
          candidateCount,
          summary: ai.summary,
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

  async autoStartImplementationTasks(projectId: string, adminUserId: string) {
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
    adminUserId: string,
  ) {
    const project = await this.getProject(projectId);
    if (!IMPLEMENTATION_MATCH_ALLOWED_STATUSES.has(project.status)) {
      throw new BadRequestException(
        'Implementation matching can only start once the project plan is materialized',
      );
    }

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
    const maxRate =
      dto.filters?.maxHourlyRate ?? (await this.affordableTaskRate(project));

    const runs = await this.dataSource.transaction(async (manager) => {
      const created: MatchingRun[] = [];
      for (const task of tasks) {
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
                maxHourlyRate: maxRate,
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
        maxRate,
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
        runResults.push({
          id: run.id,
          targetType: 'task',
          targetTaskId: task.id,
          targetRoleKey: run.targetRoleKey,
          taskTitle: task.title,
          status: 'completed',
          candidateCount,
          summary: ai.summary,
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
    return runResults;
  }

  // ---------------------------------------------------------------------------
  // Assign an implementation task
  // ---------------------------------------------------------------------------

  async assignTask(taskId: string, dto: AssignTaskDto, adminUserId: string) {
    if (!dto.candidateId && !dto.freelancerProfileId) {
      throw new BadRequestException(
        'candidateId or freelancerProfileId is required',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
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
      const profile =
        candidate?.freelancerProfile ??
        (await manager.findOne(FreelancerProfile, {
          where: { id: freelancerProfileId },
        }));
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

      task.assignedFreelancerProfileId = freelancerProfileId;
      task.sourceMatchingRunId = sourceRun?.id ?? null;
      task.sourceCandidateId = candidate?.id ?? null;
      task.assignedBy = adminUserId;
      task.assignedAt = new Date();
      if (task.status !== 'in_progress') task.status = 'todo';
      if (dto.notes) {
        task.metadata = {
          ...(task.metadata ?? {}),
          assignmentNotes: dto.notes,
        };
      }
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

      await this.advanceImplementationStatus(
        manager,
        task.projectId,
        adminUserId,
      );

      return { task, notifyUserId: profile.userId ?? null };
    });

    if (result.notifyUserId) {
      await this.notificationsService.createNotification({
        userId: result.notifyUserId,
        projectId: result.task.projectId,
        title: 'New task assignment',
        body: `You were assigned the task "${result.task.title}".`,
      });
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
    adminUserId: string,
  ) {
    const project = await manager.findOne(Project, {
      where: { id: projectId },
    });
    if (!project) return;

    const unassigned = await manager.count(ProjectTask, {
      where: {
        projectId,
        assignedFreelancerProfileId: IsNull(),
        status: Not(In(['done', 'cancelled'])),
      },
    });

    if (unassigned === 0) {
      if (project.status === ProjectStatus.ASSIGNED) return;
      await this.transitionProject(manager, project, adminUserId, {
        status: ProjectStatus.ASSIGNED,
        reason: 'All implementation tasks have assigned freelancers.',
        setAssignedAt: true,
      });
      return;
    }

    if (project.status === ProjectStatus.MATCHING) {
      await this.transitionProject(manager, project, adminUserId, {
        status: ProjectStatus.MATCHED,
        reason: 'Implementation task assignment started.',
      });
    }
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

    const counts = await this.getCandidateCounts(runs.map((run) => run.id));
    const selected = await this.getSelectedCandidateIds(runs.map((r) => r.id));

    const data = runs.map((run) => ({
      id: run.id,
      projectId: run.projectId,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      targetTaskId: run.targetTaskId,
      taskTitle: (run.inputSnapshot?.taskTitle as string | undefined) ?? null,
      status: run.status,
      summary: run.summary,
      candidateCount: counts.get(run.id) ?? 0,
      selectedCandidateId: selected.get(run.id) ?? null,
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

    const counts = await this.getCandidateCounts(runs.map((run) => run.id));
    const selected = await this.getSelectedCandidateIds(runs.map((r) => r.id));

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
      candidateCount: counts.get(run.id) ?? 0,
      selectedCandidateId: selected.get(run.id) ?? null,
      reviewedAt: run.reviewedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    }));
    return { data, total };
  }

  async getRun(runId: string) {
    const run = await this.runRepo.findOne({
      where: { id: runId },
      relations: ['project'],
    });
    if (!run) throw new NotFoundException('Matching run not found');

    const candidates = await this.candidateRepo.find({
      where: { matchingRunId: runId },
      order: { rank: 'ASC' },
      relations: ['freelancerProfile', 'freelancerProfile.user'],
    });
    const selectedCandidate =
      candidates.find((candidate) =>
        ['selected', 'assigned'].includes(candidate.status),
      ) ?? null;

    return {
      id: run.id,
      projectId: run.projectId,
      projectTitle: run.project?.title ?? null,
      targetType: run.targetType,
      targetRoleKey: run.targetRoleKey,
      targetTaskId: run.targetTaskId,
      taskTitle: (run.inputSnapshot?.taskTitle as string | undefined) ?? null,
      status: run.status,
      filters: run.filters,
      inputSnapshot: run.inputSnapshot,
      summary: run.summary,
      candidateCount: candidates.length,
      selectedCandidateId: selectedCandidate?.id ?? null,
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async createPlanningAssignment(
    manager: EntityManager,
    input: {
      run: MatchingRun;
      candidate: MatchingCandidate;
      adminUserId: string;
      notes: string | null;
    },
  ): Promise<ProjectRoleAssignment> {
    const { run, candidate, adminUserId, notes } = input;
    const roleKey = run.targetRoleKey!;
    const profile = candidate.freelancerProfile;
    if (
      !profile ||
      profile.verificationStatus !== 'approved' ||
      !profile.isAvailable
    ) {
      throw new ConflictException(
        'The selected freelancer is no longer approved and available',
      );
    }

    const existing = await manager.findOne(ProjectRoleAssignment, {
      where: {
        projectId: run.projectId,
        phase: 'planning',
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
        phase: 'planning',
        roleKey,
        status: 'assigned',
        sourceMatchingRunId: run.id,
        sourceCandidateId: candidate.id,
        assignedBy: adminUserId,
        hourlyRateSnapshot: profile?.hourlyRate ?? null,
        availabilityHoursSnapshot: profile?.availabilityHoursPerWeek ?? null,
        scoreSnapshot: {
          matchingCandidateId: candidate.id,
          score: Number(candidate.score),
        },
        notes,
        assignedAt: new Date(),
      }),
    );
  }

  private async maybeAdvanceToPlanningAssigned(
    manager: EntityManager,
    projectId: string,
    adminUserId: string,
  ) {
    const activeRoles = await manager
      .createQueryBuilder(ProjectRoleAssignment, 'a')
      .select('DISTINCT a.role_key', 'roleKey')
      .where('a.project_id = :projectId', { projectId })
      .andWhere('a.phase = :phase', { phase: 'planning' })
      .andWhere('a.status IN (:...statuses)', {
        statuses: ASSIGNMENT_ACTIVE_STATUSES,
      })
      .getRawMany<{ roleKey: string }>();

    const roleSet = new Set(activeRoles.map((row) => row.roleKey));
    if (!PLANNING_ROLES.every((role) => roleSet.has(role))) return;

    const project = await manager.findOne(Project, {
      where: { id: projectId },
    });
    if (!project || project.status === ProjectStatus.PLANNING_ASSIGNED) return;

    await this.transitionProject(manager, project, adminUserId, {
      status: ProjectStatus.PLANNING_ASSIGNED,
      planningStatus: 'assigned',
      reason: 'Both planning roles assigned.',
      setAssignedAt: true,
    });
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

  // Max hourly rate the budget can afford for a planning role. Returns null if
  // the project has no usable budget (then no budget cap is applied).
  private affordablePlanningRate(project: Project): number | null {
    const budgetMax =
      project.budgetMax != null ? Number(project.budgetMax) : null;
    if (!budgetMax || budgetMax <= 0) return null;
    const perRoleBudget =
      (budgetMax * PLANNING_BUDGET_SHARE) / PLANNING_ROLES.length;
    return Math.round(perRoleBudget / PLANNING_HOURS_PER_ROLE);
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

  private async buildCandidatePool(
    dto: StartPlanningMatchingDto,
    brief: Brief | null,
    project: Project,
  ) {
    const filters = dto.filters;
    const qb = this.buildProfileQuery(filters);

    // Budget-aware rate cap: only match freelancers the budget can afford. An
    // explicit admin maxHourlyRate wins; otherwise derive one from the budget.
    const maxRate =
      filters?.maxHourlyRate ?? this.affordablePlanningRate(project);
    const cappedQb = qb.clone();
    if (maxRate != null) {
      cappedQb.andWhere('(p.hourlyRate IS NULL OR p.hourlyRate <= :maxRate)', {
        maxRate,
      });
    }

    const poolCap = filters?.limit ? Math.min(filters.limit * 4, 100) : 60;
    let profiles = await cappedQb.take(poolCap).getMany();

    // If the budget cap left too few options, relax it — never return an empty
    // pool just because rates are high; the admin still needs candidates.
    if (
      maxRate != null &&
      filters?.maxHourlyRate == null &&
      profiles.length < MIN_AFFORDABLE_POOL
    ) {
      this.logger.warn(
        `Budget rate cap (${maxRate}) matched only ${profiles.length} freelancers for project ${project.id}; relaxing.`,
      );
      profiles = await qb.take(poolCap).getMany();
    }

    // Dense retrieval signal: cosine of the brief embedding vs. each freelancer
    // profile embedding (pgvector). Best-effort — if it fails, matching still
    // works on lexical + structured signals.
    const similarity = await this.computeTextSimilarity(
      this.briefText(brief),
      profiles.map((profile) => profile.id),
    );

    return { candidates: this.toCandidateInputs(profiles, similarity) };
  }

  // Same idea as the planning pool, but narrowed to one implementation task:
  // rate is capped by what the implementation budget affords per hour, and the
  // pool is prefiltered in SQL on the task's required skills.
  private async buildTaskCandidatePool(
    task: ProjectTask,
    filters: PlanningMatchingFiltersDto | undefined,
    maxRate: number | null,
  ): Promise<MatchCandidateInputDto[]> {
    const qb = this.buildProfileQuery(filters);
    const skills = filters?.skills?.length
      ? filters.skills
      : (task.requiredSkills ?? []);

    const narrowedQb = qb.clone();
    if (maxRate != null) {
      narrowedQb.andWhere(
        '(p.hourlyRate IS NULL OR p.hourlyRate <= :maxRate)',
        {
          maxRate,
        },
      );
    }
    if (skills.length) {
      narrowedQb.andWhere(
        `EXISTS (SELECT 1 FROM unnest(p.skills) sk WHERE lower(sk) = ANY(:taskSkills))`,
        { taskSkills: skills.map((skill) => skill.toLowerCase()) },
      );
    }

    const poolCap = filters?.limit ? Math.min(filters.limit * 4, 100) : 60;
    let profiles = await narrowedQb.take(poolCap).getMany();

    // Never hand the admin an empty pool: if the skill/rate prefilter was too
    // strict, fall back to the unnarrowed pool and let the reranker sort it out.
    if (profiles.length < MIN_AFFORDABLE_POOL) {
      this.logger.warn(
        `Task ${task.id} prefilter matched only ${profiles.length} freelancers; relaxing.`,
      );
      profiles = await qb.take(poolCap).getMany();
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

      return {
        freelancerProfileId: profile.id,
        name: this.fullName(profile.user) ?? undefined,
        headline: profile.headline ?? undefined,
        profileSummary: profile.bio ?? undefined,
        skills: profile.skills ?? [],
        skillScores: scores,
        hourlyRate:
          profile.hourlyRate != null ? Number(profile.hourlyRate) : null,
        availabilityHours: profile.availabilityHoursPerWeek ?? null,
        yearsExperience: profile.yearsExperience ?? null,
        averageSkillScore,
        embeddingSimilarity: similarity.get(profile.id) ?? null,
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

  // Max hourly rate the implementation budget affords, spread across the total
  // estimated hours of the project's tasks. Null when either is unknown.
  private async affordableTaskRate(project: Project): Promise<number | null> {
    const budgetMax =
      project.budgetMax != null ? Number(project.budgetMax) : null;
    if (!budgetMax || budgetMax <= 0) return null;

    const row = await this.taskRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.estimated_hours), 0)', 'hours')
      .where('t.project_id = :projectId', { projectId: project.id })
      .getRawOne<{ hours: string }>();

    const hours = Number(row?.hours ?? 0);
    if (!hours) return null;
    return Math.round((budgetMax * IMPLEMENTATION_BUDGET_SHARE) / hours);
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
      if (row.status === 'selected' || row.status === 'assigned') {
        selected.set(row.matchingRunId, row.id);
      }
    }
    return selected;
  }

  private buildFreelancerSummary(profile: FreelancerProfile | null) {
    if (!profile) return null;
    return {
      id: profile.id,
      name: this.fullName(profile.user),
      email: profile.user?.email ?? null,
      headline: profile.headline,
      hourlyRate:
        profile.hourlyRate != null ? Number(profile.hourlyRate) : null,
      availabilityHours: profile.availabilityHoursPerWeek,
      yearsExperience: profile.yearsExperience,
      topSkills: profile.skills ?? [],
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
}
