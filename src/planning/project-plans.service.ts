import {
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AiService } from 'src/agents/ai.service';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import type {
  ProjectPlanDependency,
  ProjectPlanMilestone,
  ProjectPlanSpec,
  ProjectPlanTask,
} from 'src/agents/ai.service';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';
import { AI_JOB_RETRY, AI_JOB_TYPES } from 'src/queues/queue.constants';
import { ProjectPlanGenerationJobData } from 'src/queues/queue.types';
import { UserRole } from 'src/common/enums/user-role.enum';
import { Project } from 'src/projects/entities/project.entity';
import { Brief } from 'src/projects/entities/brief.entity';
import { ProjectPlan } from 'src/projects/entities/project-plan.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectSpec } from 'src/projects/entities/project-spec.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { TaskCheckpoint } from 'src/projects/entities/task-checkpoint.entity';
import { ProjectTaskDependency } from 'src/projects/entities/project-task-dependency.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { MatchingService } from 'src/matching/matching.service';
import { PaymentReleaseRequest } from 'src/payments/entities/payment-release-request.entity';
import { GeneratePlanDto } from './dtos/generate-plan.dto';
import { ReviewPlanDto } from './dtos/review-plan.dto';
import { MaterializePlanDto } from './dtos/materialize-plan.dto';
import { UpdateTaskDto } from './dtos/update-task.dto';
import { assessPlanningRequirementProfile } from './planning-evaluation-requirements';
import {
  createProjectBudgetAllocation,
  implementationBudgetAmount,
  platformFeeAllocation,
} from './project-budget-allocation';
import { allocateProjectTaskBudgets } from './task-budget-allocation';
import { NotificationsService } from 'src/notifications/notifications.service';

interface Requester {
  userId: string;
  role: UserRole;
}

const DELIVERY_MANAGED_TASK_STATUSES = new Set([
  'review',
  'changes_requested',
  'done',
]);

const FREELANCER_TASK_TRANSITIONS: Record<string, Set<string>> = {
  todo: new Set(['todo', 'blocked', 'in_progress']),
  blocked: new Set(['blocked', 'todo', 'in_progress']),
  in_progress: new Set(['in_progress', 'blocked']),
  changes_requested: new Set(['changes_requested', 'blocked', 'in_progress']),
};

export function canFreelancerTransitionTask(
  currentStatus: string,
  nextStatus: string,
) {
  return FREELANCER_TASK_TRANSITIONS[currentStatus]?.has(nextStatus) ?? false;
}

@Injectable()
export class ProjectPlansService {
  private readonly logger = new Logger(ProjectPlansService.name);
  constructor(
    @InjectRepository(ProjectPlan)
    private readonly planRepo: Repository<ProjectPlan>,
    @InjectRepository(ProjectPlanningSubmission)
    private readonly submissionRepo: Repository<ProjectPlanningSubmission>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Brief)
    private readonly briefRepo: Repository<Brief>,
    @InjectRepository(ProjectRoleAssignment)
    private readonly assignmentRepo: Repository<ProjectRoleAssignment>,
    @InjectRepository(ProjectSpec)
    private readonly specRepo: Repository<ProjectSpec>,
    @InjectRepository(ProjectMilestone)
    private readonly milestoneRepo: Repository<ProjectMilestone>,
    @InjectRepository(ProjectTask)
    private readonly taskRepo: Repository<ProjectTask>,
    @InjectRepository(AgentJob)
    private readonly agentJobRepo: Repository<AgentJob>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    private readonly aiService: AiService,
    private readonly aiJobsProducer: AiJobsProducer,
    private readonly matchingService: MatchingService,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------------

  async generate(projectId: string, dto: GeneratePlanDto) {
    const project = await this.getProject(projectId);

    const architecture = await this.resolveApprovedSubmission(
      projectId,
      'architecture',
      dto.architectureSubmissionId,
    );
    const uiux = await this.resolveApprovedSubmission(
      projectId,
      'ui_ux',
      dto.uiuxSubmissionId,
    );
    const brief = await this.briefRepo.findOne({ where: { projectId } });
    const planningTeam = await this.buildPlanningTeam(projectId);
    const requirementProfile = assessPlanningRequirementProfile(project, brief);

    const generated = await this.aiService.generateProjectPlan({
      projectId,
      projectPlanJobId: this.buildPlanJobId(
        projectId,
        architecture.id,
        uiux.id,
      ),
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        currency: project.currency,
        budgetMin: Number(project.budgetMin),
        budgetMax: Number(project.budgetMax),
        deadline: project.deadline?.toISOString() ?? null,
        isDeadlineFlexible: project.isDeadlineFlexible,
      },
      brief: {
        ...this.buildBriefForPlanning(brief),
        coreFeatures: requirementProfile.features,
        requirementProfile,
      },
      architectureSubmission: {
        id: architecture.id,
        summary: architecture.summary,
        content: architecture.content ?? {},
        fileUrls: architecture.fileUrls ?? {},
        evaluationRequirements: architecture.evaluationRequirements ?? {},
        evaluationResult: architecture.evaluationResult ?? {},
        adminNotes: architecture.adminNotes,
      },
      uiuxSubmission: {
        id: uiux.id,
        summary: uiux.summary,
        content: uiux.content ?? {},
        fileUrls: uiux.fileUrls ?? {},
        evaluationRequirements: uiux.evaluationRequirements ?? {},
        evaluationResult: uiux.evaluationResult ?? {},
        adminNotes: uiux.adminNotes,
      },
      planningTeam,
      notes: dto.notes,
    });
    const generatedTaskAllocations = this.allocateImplementationTasks(
      project,
      generated.milestones,
      generated.tasks,
    );
    const generatedTasks: ProjectPlanTask[] = generated.tasks.map((task) => ({
      ...task,
      budgetAmount: generatedTaskAllocations.get(task.key)?.amount ?? null,
      currency: generatedTaskAllocations.get(task.key)?.currency ?? null,
    }));
    const generatedMilestones = this.applyMilestoneAllocations(
      generated.milestones,
      generatedTasks,
    );

    const plan = await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(Project)
        .createQueryBuilder('project')
        .setLock('pessimistic_write')
        .where('project.id = :projectId', { projectId })
        .getOneOrFail();

      await manager
        .createQueryBuilder()
        .update(ProjectPlan)
        .set({ isCurrent: false, status: 'superseded' })
        .where('project_id = :projectId', { projectId })
        .andWhere('is_current = true')
        .execute();

      const version = await this.nextPlanVersion(manager, projectId);
      return manager.save(
        ProjectPlan,
        manager.create(ProjectPlan, {
          projectId,
          version,
          status: 'generated',
          isCurrent: true,
          architectureSubmissionId: architecture.id,
          uiuxSubmissionId: uiux.id,
          generatedByJobId: null,
          summary: generated.summary,
          assumptions: this.toJson(generated.assumptions),
          timeline: generated.timeline,
          milestones: this.toJson(generatedMilestones),
          tasks: this.toJson(generatedTasks),
          dependencies: this.toJson(
            generated.dependencies.length
              ? generated.dependencies
              : this.extractDependencies(generatedTasks),
          ),
          projectSpec: this.toJson(generated.projectSpec),
          teamPlan: generated.teamPlan,
          riskRegister: this.toJson(generated.riskRegister),
        }),
      );
    });

    return {
      id: plan.id,
      projectId: plan.projectId,
      version: plan.version,
      status: plan.status,
      isCurrent: plan.isCurrent,
      summary: plan.summary,
      milestoneCount: generatedMilestones.length,
      taskCount: generatedTasks.length,
      createdAt: plan.createdAt,
    };
  }

  async enqueueAutomaticGeneration(
    projectId: string,
    adminUserId: string,
    input: {
      architectureSubmissionId?: string;
      uiuxSubmissionId?: string;
      notes?: string;
    } = {},
  ) {
    const architecture = await this.resolveApprovedSubmission(
      projectId,
      'architecture',
      input.architectureSubmissionId,
    );
    const uiux = await this.resolveApprovedSubmission(
      projectId,
      'ui_ux',
      input.uiuxSubmissionId,
    );

    const existingPlan = await this.findCurrentPlanForInputs(
      projectId,
      architecture.id,
      uiux.id,
    );
    if (existingPlan) {
      return {
        queued: false,
        reason: 'plan_already_exists',
        planId: existingPlan.id,
      };
    }

    const existingJob = await this.agentJobRepo.findOne({
      where: {
        projectId,
        jobType: AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
        status: In(['queued', 'running']),
      },
      order: { createdAt: 'DESC' },
    });
    if (existingJob) {
      const dispatch =
        await this.aiJobsProducer.ensureProjectPlanGenerationDispatch(
          existingJob,
        );
      return {
        queued: dispatch.recovered,
        reason: dispatch.recovered
          ? 'orphaned_generation_dispatch_recovered'
          : 'generation_already_queued',
        agentJobId: existingJob.id,
        queueName: existingJob.queueName,
        queueState: dispatch.state,
      };
    }

    const agentJob =
      await this.aiJobsProducer.emitProjectPlanGenerationRequested({
        projectId,
        architectureSubmissionId: architecture.id,
        uiuxSubmissionId: uiux.id,
        requestedBy: adminUserId,
        notes:
          input.notes ??
          'Automatic scrum plan generation after architecture and UI/UX approval.',
      });

    return {
      queued: true,
      agentJobId: agentJob.id,
      queueName: agentJob.queueName,
    };
  }

  async processQueuedGeneration(
    data: ProjectPlanGenerationJobData,
    attemptsMade: number,
    maxAttempts: number = AI_JOB_RETRY.ATTEMPTS,
  ) {
    await this.markPlanJobRunning(data.agentJobId, attemptsMade, maxAttempts);

    try {
      const architecture = await this.resolveApprovedSubmission(
        data.projectId,
        'architecture',
        data.architectureSubmissionId ?? undefined,
      );
      const uiux = await this.resolveApprovedSubmission(
        data.projectId,
        'ui_ux',
        data.uiuxSubmissionId ?? undefined,
      );

      const existingPlan = await this.findCurrentPlanForInputs(
        data.projectId,
        architecture.id,
        uiux.id,
      );
      if (existingPlan) {
        const output = {
          planId: existingPlan.id,
          alreadyGenerated: true,
          architectureSubmissionId: architecture.id,
          uiuxSubmissionId: uiux.id,
        };
        await this.markPlanJobCompleted(data.agentJobId, output);
        return output;
      }

      const plan = await this.generate(data.projectId, {
        architectureSubmissionId: architecture.id,
        uiuxSubmissionId: uiux.id,
        notes: data.notes ?? undefined,
      });
      const output = {
        planId: plan.id,
        projectId: plan.projectId,
        architectureSubmissionId: architecture.id,
        uiuxSubmissionId: uiux.id,
        milestoneCount: plan.milestoneCount,
        taskCount: plan.taskCount,
      };
      await this.markPlanJobCompleted(data.agentJobId, output);
      return output;
    } catch (error) {
      if (this.isFinalPlanJobAttempt(attemptsMade, maxAttempts)) {
        await this.markPlanJobFailed(data.agentJobId, error, maxAttempts);
      } else {
        await this.markPlanJobRetrying(
          data.agentJobId,
          error,
          attemptsMade,
          maxAttempts,
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // List / detail
  // ---------------------------------------------------------------------------

  async list(
    projectId: string,
    requester: Requester,
    query: {
      status?: string;
      isCurrent?: boolean;
      page: number;
      limit: number;
    },
  ) {
    const project = await this.getProject(projectId);
    await this.assertProjectVisibility(project, requester);

    const where: Record<string, unknown> = { projectId };
    if (query.status) where.status = query.status;
    if (query.isCurrent !== undefined) where.isCurrent = query.isCurrent;
    if (requester.role === UserRole.CUSTOMER) where.status = 'approved';

    const [plans, total] = await this.planRepo.findAndCount({
      where,
      order: { version: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const data = plans.map((plan) => ({
      id: plan.id,
      projectId: plan.projectId,
      version: plan.version,
      status: plan.status,
      isCurrent: plan.isCurrent,
      summary: plan.summary,
      milestoneCount: this.jsonLength(plan.milestones),
      taskCount: this.jsonLength(plan.tasks),
      approvedAt: plan.approvedAt,
      createdAt: plan.createdAt,
    }));
    return { data, total };
  }

  async getById(planId: string, requester: Requester) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const project = await this.getProject(plan.projectId);

    if (requester.role === UserRole.CUSTOMER) {
      await this.assertProjectVisibility(project, requester);
      if (plan.status !== 'approved') {
        throw new ForbiddenException('This plan is not available yet');
      }
    }
    const milestones = (plan.milestones ??
      []) as unknown as ProjectPlanMilestone[];
    const tasks = (plan.tasks ?? []) as unknown as ProjectPlanTask[];
    const taskAllocations = this.allocateImplementationTasks(
      project,
      milestones,
      tasks,
    );
    const tasksWithAllocations = tasks.map((task) => ({
      ...task,
      budgetAmount: taskAllocations.get(task.key)?.amount ?? null,
      currency: taskAllocations.get(task.key)?.currency ?? null,
    }));

    return {
      id: plan.id,
      projectId: plan.projectId,
      version: plan.version,
      status: plan.status,
      isCurrent: plan.isCurrent,
      architectureSubmissionId: plan.architectureSubmissionId,
      uiuxSubmissionId: plan.uiuxSubmissionId,
      generatedByJobId: plan.generatedByJobId,
      summary: plan.summary,
      assumptions: plan.assumptions,
      timeline: plan.timeline,
      milestones: this.applyMilestoneAllocations(
        milestones,
        tasksWithAllocations,
      ),
      tasks: tasksWithAllocations,
      dependencies: plan.dependencies,
      projectSpec: plan.projectSpec,
      teamPlan: plan.teamPlan,
      riskRegister: plan.riskRegister,
      budgetAllocation: project.budgetAllocation,
      adminNotes:
        requester.role === UserRole.ADMIN ? plan.adminNotes : undefined,
      approvedBy: plan.approvedBy,
      approvedAt: plan.approvedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin queue (all projects)
  // ---------------------------------------------------------------------------

  async adminListAll(query: { status?: string; page: number; limit: number }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    const [plans, total] = await this.planRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const titles = await this.getProjectTitles(plans.map((p) => p.projectId));

    const data = plans.map((plan) => ({
      id: plan.id,
      projectId: plan.projectId,
      projectTitle: titles.get(plan.projectId) ?? null,
      version: plan.version,
      status: plan.status,
      isCurrent: plan.isCurrent,
      summary: plan.summary,
      milestoneCount: this.jsonLength(plan.milestones),
      taskCount: this.jsonLength(plan.tasks),
      approvedAt: plan.approvedAt,
      createdAt: plan.createdAt,
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
  // Review (+ optional materialize)
  // ---------------------------------------------------------------------------

  async review(planId: string, dto: ReviewPlanDto, adminUserId: string) {
    if (dto.status === 'changes_requested' && !dto.adminNotes?.trim()) {
      throw new BadRequestException(
        'adminNotes is required when requesting changes',
      );
    }

    const plan = await this.dataSource.transaction(async (manager) => {
      const lockedPlan = await manager
        .getRepository(ProjectPlan)
        .createQueryBuilder('plan')
        .setLock('pessimistic_write')
        .where('plan.id = :planId', { planId })
        .getOne();
      if (!lockedPlan) throw new NotFoundException('Plan not found');
      if (!lockedPlan.isCurrent || lockedPlan.status !== 'generated') {
        throw new ConflictException(
          'Only the current generated plan can be reviewed',
        );
      }

      if (dto.status === 'approved') {
        const project = await manager.findOne(Project, {
          where: { id: lockedPlan.projectId },
        });
        if (!project) throw new NotFoundException('Project not found');
        const milestones = (lockedPlan.milestones ??
          []) as unknown as ProjectPlanMilestone[];
        const tasks = (lockedPlan.tasks ?? []) as unknown as ProjectPlanTask[];
        if (!tasks.length) {
          throw new BadRequestException(
            'A plan cannot be approved without implementation tasks',
          );
        }
        const allocations = this.allocateImplementationTasks(
          project,
          milestones,
          tasks,
        );
        const unallocatedTask = tasks.find((task) => {
          const allocation = allocations.get(task.key);
          return (
            !allocation?.currency ||
            allocation.amount == null ||
            Number(allocation.amount) <= 0
          );
        });
        if (unallocatedTask) {
          throw new BadRequestException(
            `Plan approval requires positive compensation for every task. Missing allocation for: ${unallocatedTask.title}`,
          );
        }
        await this.assertImplementationBudgetFeasible(
          manager,
          project,
          tasks,
          allocations,
        );
      }

      lockedPlan.status = dto.status;
      lockedPlan.adminNotes = dto.adminNotes ?? lockedPlan.adminNotes ?? null;
      if (dto.status === 'approved') {
        lockedPlan.approvedBy = adminUserId;
        lockedPlan.approvedAt = new Date();
      }
      return manager.save(ProjectPlan, lockedPlan);
    });

    const response: Record<string, unknown> = {
      id: plan.id,
      status: plan.status,
      approvedBy: plan.approvedBy,
      approvedAt: plan.approvedAt,
    };

    // Approval is the principal-reviewer gate. Once that gate passes there is
    // no useful intermediate "approved but not materialized" state: create the
    // tasks and begin matching automatically.
    if (dto.status === 'approved') {
      response.materialization = await this.materialize(
        planId,
        {},
        adminUserId,
      );
    }
    return response;
  }

  async recoverApprovedUnmaterializedPlans() {
    const cutoff = new Date(Date.now() - 60_000);
    const plans = await this.planRepo
      .createQueryBuilder('plan')
      .leftJoin(ProjectTask, 'task', 'task.project_plan_id = plan.id')
      .where('plan.status = :status', { status: 'approved' })
      .andWhere('plan.is_current = true')
      .andWhere('plan.approved_at IS NOT NULL')
      .andWhere('plan.approved_at <= :cutoff', { cutoff })
      .andWhere('task.id IS NULL')
      .andWhere('plan.approved_by IS NOT NULL')
      .orderBy('plan.approved_at', 'ASC')
      .limit(10)
      .getMany();

    let recovered = 0;
    const recoveredProjectIds: string[] = [];
    const failures: Array<{
      planId: string;
      projectId: string;
      error: string;
    }> = [];
    for (const plan of plans) {
      try {
        await this.materialize(plan.id, {}, plan.approvedBy!);
        recovered += 1;
        recoveredProjectIds.push(plan.projectId);
      } catch (error) {
        failures.push({
          planId: plan.id,
          projectId: plan.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      inspected: plans.length,
      recovered,
      recoveredProjectIds,
      failures,
    };
  }

  async recoverMissingPlanGenerations() {
    const projects = await this.projectRepo.find({
      where: { status: ProjectStatus.PLANNING_REVIEW },
      order: { updatedAt: 'ASC' },
      take: 10,
    });
    let queued = 0;
    const queuedProjectIds: string[] = [];
    const failures: Array<{ projectId: string; error: string }> = [];

    for (const project of projects) {
      const currentPlan = await this.planRepo.findOne({
        where: { projectId: project.id, isCurrent: true },
      });
      if (currentPlan) continue;

      const [architecture, uiux] = await Promise.all([
        this.submissionRepo.findOne({
          where: {
            projectId: project.id,
            submissionType: 'architecture',
            status: 'approved',
          },
          order: { version: 'DESC' },
        }),
        this.submissionRepo.findOne({
          where: {
            projectId: project.id,
            submissionType: 'ui_ux',
            status: 'approved',
          },
          order: { version: 'DESC' },
        }),
      ]);
      const requestedBy = uiux?.reviewedBy ?? architecture?.reviewedBy;
      if (!architecture || !uiux || !requestedBy) continue;

      try {
        const result = await this.enqueueAutomaticGeneration(
          project.id,
          requestedBy,
          {
            architectureSubmissionId: architecture.id,
            uiuxSubmissionId: uiux.id,
            notes:
              'Recovered Scrum plan generation after both planning deliverables were approved.',
          },
        );
        if (result.queued) {
          queued += 1;
          queuedProjectIds.push(project.id);
        }
      } catch (error) {
        failures.push({
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { inspected: projects.length, queued, queuedProjectIds, failures };
  }

  // ---------------------------------------------------------------------------
  // Materialize
  // ---------------------------------------------------------------------------

  async materialize(
    planId: string,
    dto: MaterializePlanDto,
    adminUserId: string,
  ) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== 'approved') {
      throw new BadRequestException(
        'Only an approved plan can be materialized',
      );
    }
    if (!plan.isCurrent) {
      throw new ConflictException(
        'Only the current approved plan can be materialized',
      );
    }

    const milestones = (plan.milestones ??
      []) as unknown as ProjectPlanMilestone[];
    const tasks = (plan.tasks ?? []) as unknown as ProjectPlanTask[];
    const dependencies = this.planDependencies(plan.dependencies, tasks);
    const projectSpec = (plan.projectSpec ?? {}) as ProjectPlanSpec;

    const materialization = await this.dataSource.transaction(
      async (manager) => {
        let scheduleOverrunDays: number | null = null;
        const project = await manager
          .getRepository(Project)
          .createQueryBuilder('project')
          .setLock('pessimistic_write')
          .where('project.id = :projectId', { projectId: plan.projectId })
          .getOne();
        if (!project) throw new NotFoundException('Project not found');
        const taskBudgetAllocations = this.allocateImplementationTasks(
          project,
          milestones,
          tasks,
        );
        const budgetedTasks = tasks.map((task) => ({
          ...task,
          budgetAmount: taskBudgetAllocations.get(task.key)?.amount ?? null,
          currency: taskBudgetAllocations.get(task.key)?.currency ?? null,
        }));
        const budgetedMilestones = this.applyMilestoneAllocations(
          milestones,
          budgetedTasks,
        );

        const lockedPlan = await manager
          .getRepository(ProjectPlan)
          .createQueryBuilder('plan')
          .setLock('pessimistic_write')
          .where('plan.id = :planId', { planId })
          .getOne();
        if (!lockedPlan) throw new NotFoundException('Plan not found');
        if (lockedPlan.status !== 'approved' || !lockedPlan.isCurrent) {
          throw new ConflictException(
            'The plan is no longer the current approved plan',
          );
        }

        const existingSpec = await manager.findOne(ProjectSpec, {
          where: { projectId: plan.projectId },
        });
        if (existingSpec && !dto.replaceExisting) {
          // A transaction-scoped EntityManager owns one PostgreSQL client, so
          // its queries must remain sequential (pg rejects concurrent client
          // queries starting with v9).
          const milestoneCount = await manager.count(ProjectMilestone, {
            where: { projectId: plan.projectId },
          });
          const taskCount = await manager.count(ProjectTask, {
            where: { projectId: plan.projectId },
          });
          const dependencyCount = await manager
            .getRepository(ProjectTaskDependency)
            .createQueryBuilder('dependency')
            .innerJoin(ProjectTask, 'task', 'task.id = dependency.task_id')
            .where('task.project_id = :projectId', {
              projectId: plan.projectId,
            })
            .getCount();
          return {
            projectId: plan.projectId,
            planId: existingSpec.approvedPlanId,
            specId: existingSpec.id,
            projectStatus: project.status,
            planningStatus: project.planningStatus,
            milestoneCount,
            taskCount,
            dependencyCount,
            alreadyMaterialized: true,
          };
        }

        if (existingSpec && dto.replaceExisting) {
          await this.assertMaterializationReplaceable(manager, plan.projectId);
          await manager.delete(ProjectTask, { projectId: plan.projectId });
          await manager.delete(ProjectMilestone, { projectId: plan.projectId });
          await manager.delete(ProjectSpec, { projectId: plan.projectId });
        }

        if (!tasks.length) {
          throw new BadRequestException(
            'An approved plan must contain at least one budgeted implementation task',
          );
        }
        const unallocatedTask = tasks.find((task) => {
          const allocation = taskBudgetAllocations.get(task.key);
          return (
            !allocation?.currency ||
            allocation.amount == null ||
            Number(allocation.amount) <= 0
          );
        });
        if (unallocatedTask) {
          throw new BadRequestException(
            `Every implementation task must have a positive share of its milestone budget before materialization. Missing allocation for: ${unallocatedTask.title}`,
          );
        }

        const milestoneIdByKey = new Map<string, string>();
        let quotedAmount = 0;
        let quotedCurrency: string | null = null;
        for (const milestone of budgetedMilestones) {
          const milestoneBudgetAmount =
            milestone.budgetAmount != null
              ? Number(milestone.budgetAmount)
              : null;
          if (
            milestoneBudgetAmount !== null &&
            Number.isFinite(milestoneBudgetAmount) &&
            milestoneBudgetAmount > 0
          ) {
            quotedAmount += milestoneBudgetAmount;
            quotedCurrency = quotedCurrency ?? milestone.currency ?? null;
          }

          const saved = await manager.save(
            ProjectMilestone,
            manager.create(ProjectMilestone, {
              projectId: plan.projectId,
              projectPlanId: plan.id,
              title: milestone.title,
              description: milestone.description ?? null,
              status: 'planned',
              orderIndex: milestone.orderIndex ?? 0,
              startsAt: this.dateAtPlanDay(plan.createdAt, milestone.startDay),
              dueAt: this.dateAtPlanDay(
                plan.createdAt,
                (milestone.startDay ?? 0) +
                  Math.max(1, milestone.estimatedDays ?? 1),
              ),
              budgetAmount:
                milestoneBudgetAmount !== null &&
                Number.isFinite(milestoneBudgetAmount)
                  ? milestoneBudgetAmount.toFixed(2)
                  : null,
              currency: milestone.currency ?? null,
              acceptanceCriteria: this.toJsonList(milestone.acceptanceCriteria),
            }),
          );
          milestoneIdByKey.set(milestone.key, saved.id);
        }

        const taskIdByKey = new Map<string, string>();
        for (const task of tasks) {
          const budgetAllocation = taskBudgetAllocations.get(task.key);
          const saved = await manager.save(
            ProjectTask,
            manager.create(ProjectTask, {
              projectId: plan.projectId,
              projectPlanId: plan.id,
              milestoneId: milestoneIdByKey.get(task.milestoneKey) ?? null,
              assignmentId: null,
              assignedFreelancerProfileId: null,
              title: task.title,
              description: task.description ?? null,
              status: 'todo',
              priority: task.priority ?? 'medium',
              roleKey: task.roleKey ?? null,
              requiredSkills: task.requiredSkills ?? null,
              estimatedHours:
                task.estimatedHours != null
                  ? String(task.estimatedHours)
                  : null,
              budgetAmount: budgetAllocation?.amount ?? null,
              currency: budgetAllocation?.currency ?? null,
              orderIndex: task.orderIndex ?? 0,
              startsAt: this.dateAtPlanDay(plan.createdAt, task.startDay),
              dueAt: this.dateAtPlanDay(
                plan.createdAt,
                (task.startDay ?? 0) + Math.max(1, task.durationDays ?? 1),
              ),
              acceptanceCriteria: this.toJsonList(task.acceptanceCriteria),
              metadata: {
                contractReferences: task.contractReferences ?? [],
                ownedPaths: task.ownedPaths ?? [],
                integrationChecks: task.integrationChecks ?? [],
              },
            }),
          );
          taskIdByKey.set(task.key, saved.id);

          const checkpoints = task.checkpoints?.length
            ? task.checkpoints
            : [
                {
                  key: `${task.key}-progress`,
                  title: 'Progress checkpoint',
                  offsetDays: Math.max(
                    0,
                    Math.floor((task.durationDays ?? 1) / 2),
                  ),
                  weightPercent: 40,
                  penaltyPercent: 3,
                },
                {
                  key: `${task.key}-final`,
                  title: 'Final delivery',
                  offsetDays: Math.max(1, task.durationDays ?? 1),
                  weightPercent: 60,
                  penaltyPercent: 7,
                },
              ];
          for (const [checkpointIndex, checkpoint] of checkpoints.entries()) {
            await manager.save(
              TaskCheckpoint,
              manager.create(TaskCheckpoint, {
                taskId: saved.id,
                title: checkpoint.title,
                orderIndex: checkpointIndex,
                dueAt: this.dateAtPlanDay(
                  plan.createdAt,
                  (task.startDay ?? 0) +
                    Math.max(
                      1,
                      Math.min(
                        Math.max(0, checkpoint.offsetDays),
                        Math.max(1, task.durationDays ?? 1),
                      ),
                    ),
                ),
                weightPercent: Number(checkpoint.weightPercent).toFixed(2),
                penaltyPercent: Number(checkpoint.penaltyPercent).toFixed(2),
                graceMinutes: 60,
                status: 'pending',
                penaltyAmount: '0.00',
                metadata: { key: checkpoint.key },
              }),
            );
          }
        }

        let dependencyCount = 0;
        for (const dependency of dependencies) {
          const taskId = taskIdByKey.get(dependency.taskKey);
          const dependsOnTaskId = taskIdByKey.get(dependency.dependsOnKey);
          if (!taskId || !dependsOnTaskId || dependsOnTaskId === taskId) {
            continue;
          }
          await manager.save(
            ProjectTaskDependency,
            manager.create(ProjectTaskDependency, {
              taskId,
              dependsOnTaskId,
              dependencyType: dependency.type,
              notes: dependency.notes ?? null,
            }),
          );
          dependencyCount += 1;
        }

        // A plan can be generated whose last task already ends after the
        // customer's deadline. Previously nothing compared the two at generation
        // time — the only check ran on rematch, long after work had started.
        // This warns; it does not block, and it does not move the deadline.
        // See ISSUES.md #26.
        if (project.deadline) {
          const latestDueAt = await manager
            .getRepository(ProjectTask)
            .createQueryBuilder('task')
            .select('MAX(task.dueAt)', 'latest')
            .where('task.projectId = :projectId', { projectId: plan.projectId })
            .getRawOne<{ latest: Date | null }>();
          const latest = latestDueAt?.latest
            ? new Date(latestDueAt.latest)
            : null;
          if (latest && latest.getTime() > project.deadline.getTime()) {
            const overrunDays = Math.ceil(
              (latest.getTime() - project.deadline.getTime()) / 86_400_000,
            );
            this.logger.warn(
              `Plan ${plan.id} for project ${plan.projectId} ends ${overrunDays} day(s) after the customer deadline (${project.deadline.toISOString().slice(0, 10)}).`,
            );
            scheduleOverrunDays = overrunDays;
          }
        }

        const spec = await manager.save(
          ProjectSpec,
          manager.create(ProjectSpec, {
            projectId: plan.projectId,
            approvedPlanId: plan.id,
            architecture: this.specSection(projectSpec.architecture, {
              architectureSubmissionId: plan.architectureSubmissionId,
            }),
            designSystem: this.specSection(projectSpec.designSystem, {
              uiuxSubmissionId: plan.uiuxSubmissionId,
            }),
            apiContract: this.specSection(projectSpec.apiContract),
            dataModel: this.specSection(projectSpec.dataModel),
            conventions: this.specSection(projectSpec.conventions),
            approvedBy: adminUserId,
            lockedAt: new Date(),
          }),
        );

        const oldStatus = project.status;
        const quote = this.shouldBackfillPlanQuote(project)
          ? this.buildProjectQuote(project, quotedAmount, quotedCurrency)
          : null;
        if (quote) {
          project.quotedAmount = quote.amount;
          project.quotedCurrency = quote.currency;
          project.quoteStatus = quote.status;
          project.quoteGeneratedAt = quote.generatedAt;
          project.quoteNotes = quote.notes;
          if (quote.amount && quote.currency) {
            project.budgetAllocation = createProjectBudgetAllocation(
              quote.amount,
              quote.currency,
            );
            project.platformFeeAmount =
              platformFeeAllocation(project.budgetAllocation)?.amount ?? '0.00';
          }
        }
        project.status = ProjectStatus.IMPLEMENTATION_READY;
        project.planningStatus = 'completed';
        project.planningCompletedAt = project.planningCompletedAt ?? new Date();
        project.implementationReadyAt =
          project.implementationReadyAt ?? new Date();
        await manager.save(Project, project);
        if (oldStatus !== ProjectStatus.IMPLEMENTATION_READY) {
          await manager.save(
            ProjectStatusHistory,
            manager.create(ProjectStatusHistory, {
              projectId: project.id,
              oldStatus,
              newStatus: ProjectStatus.IMPLEMENTATION_READY,
              changedBy: adminUserId,
              changedByType: 'admin',
              reason: 'Plan materialized into tasks.',
            }),
          );
        }

        return {
          projectId: plan.projectId,
          planId: plan.id,
          projectStatus: ProjectStatus.IMPLEMENTATION_READY,
          planningStatus: 'completed',
          quote: {
            amount: project?.quotedAmount ?? null,
            currency: project?.quotedCurrency ?? null,
            status: project?.quoteStatus ?? 'not_ready',
            notes: project?.quoteNotes ?? null,
          },
          specId: spec.id,
          milestoneCount: milestoneIdByKey.size,
          taskCount: taskIdByKey.size,
          dependencyCount,
          scheduleOverrunDays,
        };
      },
    );
    // Tell the customer up front if the plan already overruns their deadline,
    // rather than leaving them to discover it when the work lands late.
    // Warning only — it does not block materialization. ISSUES.md #26.
    const { scheduleOverrunDays, ...materialized } = materialization;
    if (typeof scheduleOverrunDays === 'number' && scheduleOverrunDays > 0) {
      const overrunProject = await this.dataSource
        .getRepository(Project)
        .findOne({ where: { id: plan.projectId } });
      if (overrunProject?.customerId) {
        await this.notificationsService
          .createNotification({
            userId: overrunProject.customerId,
            projectId: plan.projectId,
            type: 'schedule_risk',
            title: 'The plan finishes after your deadline',
            body: `The approved plan currently ends about ${scheduleOverrunDays} day(s) after your deadline${overrunProject.deadline ? ` of ${overrunProject.deadline.toISOString().slice(0, 10)}` : ''}. Your principal reviewer can adjust scope or agree a new date with you.`,
            actionUrl: `/projects/${plan.projectId}`,
          })
          .catch((error: unknown) =>
            this.logger.error(
              `Could not notify customer of schedule overrun for project ${plan.projectId}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      }
    }

    const matchingDispatch =
      await this.matchingService.autoStartImplementationTasks(
        plan.projectId,
        adminUserId,
      );
    return { ...materialized, matchingDispatch };
  }

  // ---------------------------------------------------------------------------
  // Milestones / tasks read + task patch
  // ---------------------------------------------------------------------------

  async listMilestones(projectId: string, requester: Requester) {
    const project = await this.getProject(projectId);
    await this.assertProjectVisibility(project, requester);

    const milestones = await this.milestoneRepo.find({
      where: { projectId },
      order: { orderIndex: 'ASC' },
    });
    const counts = await this.taskCountsByMilestone(projectId);

    return milestones.map((milestone) => ({
      id: milestone.id,
      projectId: milestone.projectId,
      projectPlanId: milestone.projectPlanId,
      title: milestone.title,
      description: milestone.description,
      status: milestone.status,
      orderIndex: milestone.orderIndex,
      startsAt: milestone.startsAt,
      dueAt: milestone.dueAt,
      budgetAmount: milestone.budgetAmount,
      currency: milestone.currency,
      acceptanceCriteria: milestone.acceptanceCriteria,
      taskCount: counts.get(milestone.id) ?? 0,
    }));
  }

  async listTasks(
    projectId: string,
    requester: Requester,
    query: {
      milestoneId?: string;
      status?: string;
      assignedFreelancerProfileId?: string;
      page: number;
      limit: number;
    },
  ) {
    const project = await this.getProject(projectId);
    await this.assertProjectVisibility(project, requester);

    const where: Record<string, unknown> = { projectId };
    if (query.milestoneId) where.milestoneId = query.milestoneId;
    if (query.status) where.status = query.status;
    if (query.assignedFreelancerProfileId) {
      where.assignedFreelancerProfileId = query.assignedFreelancerProfileId;
    }

    const [tasks, total] = await this.taskRepo.findAndCount({
      where,
      order: { orderIndex: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: ['dependencies'],
    });

    const data = tasks.map((task) => this.taskResponse(task));
    return { data, total };
  }

  async listAssignedFreelancerTasks(
    userId: string,
    query: { status?: string; page: number; limit: number },
  ) {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) return { data: [], total: 0 };

    const where: Record<string, unknown> = {
      assignedFreelancerProfileId: profile.id,
    };
    if (query.status) where.status = query.status;

    const [tasks, total] = await this.taskRepo.findAndCount({
      where,
      order: { dueAt: 'ASC', orderIndex: 'ASC', createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: ['dependencies', 'project', 'milestone'],
    });

    const data = tasks.map((task) => this.taskResponse(task, true));
    return { data, total };
  }

  private taskResponse(task: ProjectTask, includeContext = false) {
    return {
      id: task.id,
      projectId: task.projectId,
      projectPlanId: task.projectPlanId,
      milestoneId: task.milestoneId,
      assignmentId: task.assignmentId,
      assignedFreelancerProfileId: task.assignedFreelancerProfileId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      roleKey: task.roleKey,
      requiredSkills: task.requiredSkills,
      estimatedHours: task.estimatedHours,
      budgetAmount: task.budgetAmount,
      currency: task.currency,
      orderIndex: task.orderIndex,
      startsAt: task.startsAt,
      dueAt: task.dueAt,
      penaltyAmount: task.penaltyAmount,
      deadlineStrikes: task.deadlineStrikes,
      maxDeadlineStrikes: task.maxDeadlineStrikes,
      assignmentStatus: task.assignmentStatus,
      acceptanceCriteria: task.acceptanceCriteria,
      metadata: task.metadata,
      sourceMatchingRunId: task.sourceMatchingRunId,
      sourceCandidateId: task.sourceCandidateId,
      assignedBy: task.assignedBy,
      assignedAt: task.assignedAt,
      project:
        includeContext && task.project
          ? {
              id: task.project.id,
              title: task.project.title,
              status: task.project.status,
              currency: task.project.currency,
            }
          : null,
      milestone:
        includeContext && task.milestone
          ? {
              id: task.milestone.id,
              title: task.milestone.title,
              status: task.milestone.status,
            }
          : null,
      dependencies: (task.dependencies ?? []).map((dep) => ({
        taskId: dep.taskId,
        dependsOnTaskId: dep.dependsOnTaskId,
        dependencyType: dep.dependencyType,
        notes: dep.notes,
      })),
    };
  }

  async updateTask(taskId: string, dto: UpdateTaskDto, requester: Requester) {
    const isAdmin = requester.role === UserRole.ADMIN;
    if (
      dto.assignedFreelancerProfileId !== undefined ||
      dto.assignmentId !== undefined
    ) {
      throw new BadRequestException(
        'Use the task assignment endpoint to assign a freelancer',
      );
    }
    if (dto.status && DELIVERY_MANAGED_TASK_STATUSES.has(dto.status)) {
      throw new BadRequestException(
        `${dto.status} is managed by the submission review workflow`,
      );
    }

    const task = await this.dataSource.transaction(async (manager) => {
      const lockedTask = await manager
        .getRepository(ProjectTask)
        .createQueryBuilder('task')
        .setLock('pessimistic_write')
        .where('task.id = :taskId', { taskId })
        .getOne();
      if (!lockedTask) throw new NotFoundException('Task not found');
      if (
        lockedTask.assignmentStatus === 'reserved' &&
        dto.status &&
        dto.status !== 'todo'
      ) {
        throw new ConflictException(
          'Implementation work cannot start until the customer funds the implementation escrow',
        );
      }

      if (!isAdmin) {
        const profile = await manager.findOne(FreelancerProfile, {
          where: { userId: requester.userId },
        });
        if (!profile || lockedTask.assignedFreelancerProfileId !== profile.id) {
          throw new ForbiddenException('You can only update your own task');
        }
        if (
          dto.status &&
          !canFreelancerTransitionTask(lockedTask.status, dto.status)
        ) {
          throw new ConflictException(
            `A freelancer cannot move a task from ${lockedTask.status} to ${dto.status}`,
          );
        }
      }

      if (dto.status === 'in_progress') {
        await this.assertDependenciesDone(taskId, manager);
      }
      if (dto.status) lockedTask.status = dto.status;
      if (dto.notes !== undefined) {
        lockedTask.metadata = {
          ...(lockedTask.metadata ?? {}),
          statusNotes: dto.notes.trim() || null,
          statusUpdatedBy: requester.userId,
          statusUpdatedAt: new Date().toISOString(),
        };
      }
      return manager.save(ProjectTask, lockedTask);
    });

    return {
      id: task.id,
      status: task.status,
      assignedFreelancerProfileId: task.assignedFreelancerProfileId,
      assignmentId: task.assignmentId,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findCurrentPlanForInputs(
    projectId: string,
    architectureSubmissionId: string,
    uiuxSubmissionId: string,
  ) {
    return this.planRepo.findOne({
      where: {
        projectId,
        architectureSubmissionId,
        uiuxSubmissionId,
        isCurrent: true,
        status: In(['generated', 'under_review', 'approved']),
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async markPlanJobRunning(
    agentJobId: string,
    attemptsMade: number,
    maxAttempts: number,
  ) {
    await this.agentJobRepo.update(
      { id: agentJobId },
      {
        status: 'running',
        attempts: attemptsMade + 1,
        maxAttempts,
        lockedAt: new Date(),
        startedAt: new Date(),
        error: null,
        failedAt: null,
      },
    );
  }

  private async markPlanJobCompleted(
    agentJobId: string,
    output: Record<string, unknown>,
  ) {
    const agentJob = await this.agentJobRepo.findOne({
      where: { id: agentJobId },
    });
    if (!agentJob) return;

    agentJob.status = 'completed';
    agentJob.output = output;
    agentJob.completedAt = new Date();
    agentJob.lockedAt = null;
    agentJob.error = null;
    await this.agentJobRepo.save(agentJob);
  }

  private async markPlanJobRetrying(
    agentJobId: string,
    error: unknown,
    attemptsMade: number,
    maxAttempts: number,
  ) {
    const currentAttempt = attemptsMade + 1;
    await this.agentJobRepo.update(
      { id: agentJobId },
      {
        status: 'queued',
        attempts: currentAttempt,
        maxAttempts,
        error: this.getErrorMessage(error),
        output: {
          retrying: true,
          attempt: currentAttempt,
          maxAttempts,
        },
        lockedAt: null,
        failedAt: null,
      },
    );
  }

  private async markPlanJobFailed(
    agentJobId: string,
    error: unknown,
    maxAttempts: number,
  ) {
    await this.agentJobRepo.update(
      { id: agentJobId },
      {
        status: 'failed',
        error: this.getErrorMessage(error),
        maxAttempts,
        failedAt: new Date(),
        lockedAt: null,
      },
    );
  }

  private isFinalPlanJobAttempt(attemptsMade: number, maxAttempts: number) {
    return attemptsMade + 1 >= maxAttempts;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message.slice(0, 1000);
    return String(error).slice(0, 1000);
  }

  private dateAtPlanDay(planCreatedAt: Date, day = 0) {
    const value = new Date(Math.max(planCreatedAt.getTime(), Date.now()));
    value.setUTCDate(value.getUTCDate() + Math.max(0, Math.floor(day)));
    return value;
  }

  private allocateImplementationTasks(
    project: Project,
    milestones: ProjectPlanMilestone[],
    tasks: ProjectPlanTask[],
  ) {
    const milestoneKeys = new Set(milestones.map((milestone) => milestone.key));
    const taskKeys = new Set(tasks.map((task) => task.key));
    if (milestoneKeys.size !== milestones.length) {
      throw new BadRequestException('Plan milestone keys must be unique');
    }
    if (taskKeys.size !== tasks.length) {
      throw new BadRequestException('Plan task keys must be unique');
    }
    const orphanTask = tasks.find(
      (task) => !milestoneKeys.has(task.milestoneKey),
    );
    if (orphanTask) {
      throw new BadRequestException(
        `Task "${orphanTask.title}" references an unknown milestone`,
      );
    }
    const allocatedPool = implementationBudgetAmount(project.budgetAllocation);
    const quotedAmount = Number(project.quotedAmount);
    const generatedMilestoneTotal = milestones.reduce((sum, milestone) => {
      const amount = Number(milestone.budgetAmount);
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
    }, 0);
    const implementationPool =
      allocatedPool && allocatedPool > 0
        ? allocatedPool
        : Number.isFinite(quotedAmount) && quotedAmount > 0
          ? quotedAmount * 0.5
          : generatedMilestoneTotal;

    return allocateProjectTaskBudgets(
      implementationPool,
      tasks,
      project.quotedCurrency ?? project.currency,
    );
  }

  private applyMilestoneAllocations(
    milestones: ProjectPlanMilestone[],
    tasks: ProjectPlanTask[],
  ): ProjectPlanMilestone[] {
    const totals = new Map<
      string,
      { cents: number; currency: string | null }
    >();
    for (const task of tasks) {
      const amount = Number(task.budgetAmount);
      if (!Number.isFinite(amount) || amount < 0) continue;
      const current = totals.get(task.milestoneKey) ?? {
        cents: 0,
        currency: task.currency?.trim().toUpperCase() ?? null,
      };
      current.cents += Math.round(amount * 100);
      current.currency =
        current.currency ?? task.currency?.trim().toUpperCase() ?? null;
      totals.set(task.milestoneKey, current);
    }
    return milestones.map((milestone) => {
      const total = totals.get(milestone.key);
      return {
        ...milestone,
        budgetAmount: total ? total.cents / 100 : null,
        currency: total?.currency ?? milestone.currency ?? null,
      };
    });
  }

  private async assertImplementationBudgetFeasible(
    manager: EntityManager,
    project: Project,
    tasks: ProjectPlanTask[],
    allocations: Map<
      string,
      { amount: string | null; currency: string | null }
    >,
  ) {
    const profiles = await manager.find(FreelancerProfile, {
      where: { verificationStatus: 'approved', isAvailable: true },
      select: { id: true, hourlyRate: true },
    });
    const rates = profiles
      .map((profile) => Number(profile.hourlyRate))
      .filter((rate) => Number.isFinite(rate) && rate > 0)
      .sort((left, right) => left - right);
    if (!rates.length) {
      throw new ConflictException(
        'No approved available developer has a usable hourly rate. Add an eligible freelancer before approving this plan.',
      );
    }

    for (const task of tasks) {
      const allocation = allocations.get(task.key);
      const amount = Number(allocation?.amount);
      const hours = Number(task.estimatedHours);
      if (!Number.isFinite(amount) || amount <= 0 || !hours || hours <= 0) {
        throw new BadRequestException(
          `Task "${task.title}" needs positive compensation and estimated hours before plan approval.`,
        );
      }
      const maxRate = Math.floor((amount / hours) * 100) / 100;
      if (rates.some((rate) => rate <= maxRate)) continue;

      const currentTotal = Number(project.quotedAmount) || amount * 2;
      const expectedCost = rates[0] * hours;
      const requiredTotal =
        Math.ceil(((expectedCost * currentTotal) / amount) * 100) / 100;
      throw new ConflictException(
        `Task "${task.title}" is allocated ${amount.toFixed(2)} ${allocation?.currency ?? project.currency} (${maxRate.toFixed(2)}/hour), below every available developer rate. Increase the project total to about ${requiredTotal.toFixed(2)} (an increase of ${Math.max(requiredTotal - currentTotal, 0).toFixed(2)}) before approving the plan.`,
      );
    }
  }

  private async resolveApprovedSubmission(
    projectId: string,
    submissionType: string,
    submissionId?: string,
  ) {
    const submission = submissionId
      ? await this.submissionRepo.findOne({ where: { id: submissionId } })
      : await this.submissionRepo.findOne({
          where: { projectId, submissionType },
          order: { version: 'DESC' },
        });

    if (!submission || submission.projectId !== projectId) {
      throw new BadRequestException(
        `Approved ${submissionType} submission not found`,
      );
    }
    if (submission.status !== 'approved') {
      throw new BadRequestException(
        `The ${submissionType} submission must be approved first`,
      );
    }
    return submission;
  }

  private buildProjectQuote(
    project: Project,
    quotedAmount: number,
    quotedCurrency: string | null,
  ) {
    if (!Number.isFinite(quotedAmount) || quotedAmount <= 0) {
      return {
        amount: null,
        currency: null,
        status: 'not_ready',
        generatedAt: null,
        notes:
          'The plan is ready, but no milestone budgets were generated yet. An admin should add pricing before requesting payment.',
      };
    }

    const budgetMax = Number(project.budgetMax);
    const currency = quotedCurrency ?? project.currency;
    const amount = quotedAmount.toFixed(2);
    const isOutOfBudget =
      Number.isFinite(budgetMax) && quotedAmount > budgetMax;

    return {
      amount,
      currency,
      status: isOutOfBudget ? 'out_of_budget' : 'pending_customer',
      generatedAt: new Date(),
      notes: isOutOfBudget
        ? `The final estimate is ${amount} ${currency}, which is above the customer's maximum budget of ${project.budgetMax} ${project.currency}. Ask the customer to revise the budget range before payment.`
        : 'Legacy estimate backfilled from the approved Scrum Master milestone plan.',
    };
  }

  private shouldBackfillPlanQuote(project: Project) {
    if (Number(project.heldAmount ?? 0) > 0) return false;
    if (project.quoteStatus && project.quoteStatus !== 'not_ready') {
      return false;
    }
    return !project.quotedAmount;
  }

  private async nextPlanVersion(manager: EntityManager, projectId: string) {
    const latest = await manager.findOne(ProjectPlan, {
      where: { projectId },
      order: { version: 'DESC' },
    });
    return (latest?.version ?? 0) + 1;
  }

  private buildPlanJobId(
    projectId: string,
    architectureSubmissionId: string,
    uiuxSubmissionId: string,
  ) {
    return `${projectId}:${architectureSubmissionId}:${uiuxSubmissionId}`;
  }

  private buildBriefForPlanning(brief: Brief | null) {
    return {
      projectType: brief?.projectType ?? null,
      businessDomain: brief?.domain ?? null,
      mainGoal: brief?.mainGoal ?? null,
      targetUsers: brief?.targetUsers ?? null,
      coreFeatures: this.textToList(brief?.coreFeatures),
      platforms: this.textToList(brief?.platforms),
      deliverables: this.textToList(brief?.deliverablesText).length
        ? this.textToList(brief?.deliverablesText)
        : this.recordToList(brief?.deliverables),
      constraintsPreferences: this.textToList(brief?.constraintsPreferences),
      clientBackground: brief?.clientBackground ?? null,
      rawBrief: {
        id: brief?.id ?? null,
        summary: brief?.summary ?? null,
        briefText: brief?.briefText ?? null,
        budget: brief?.budget ?? null,
        deadlineText: brief?.deadlineText ?? null,
        deadlineDate: brief?.deadlineDate ?? null,
        requiredSkills: brief?.requiredSkills ?? null,
        preferredSkills: brief?.preferredSkills ?? null,
        suggestedTeamSize: brief?.suggestedTeamSize ?? null,
        experienceLevel: brief?.experienceLevel ?? null,
        experienceMinYears: brief?.experienceMinYears ?? null,
        technical: brief?.technical ?? null,
        nonFunctional: brief?.nonFunctional ?? null,
        acceptanceCriteria: brief?.acceptanceCriteria ?? null,
        extractedFields: brief?.extractedFields ?? null,
      },
    };
  }

  private async buildPlanningTeam(projectId: string) {
    const assignments = await this.assignmentRepo.find({
      where: {
        projectId,
        phase: 'planning',
        status: In(['assigned', 'accepted', 'in_progress', 'completed']),
      },
      relations: ['freelancerProfile'],
      order: { createdAt: 'ASC' },
    });

    return assignments
      .filter((assignment) => assignment.freelancerProfileId)
      .map((assignment) => ({
        roleKey: assignment.roleKey,
        freelancerProfileId: assignment.freelancerProfileId!,
        headline: assignment.freelancerProfile?.headline ?? null,
      }));
  }

  private planDependencies(
    value: Record<string, unknown> | null,
    tasks: ProjectPlanTask[],
  ): ProjectPlanDependency[] {
    const dependencies = Array.isArray(value)
      ? (value as unknown as ProjectPlanDependency[])
      : [];
    if (dependencies.length) {
      return dependencies
        .map((dependency) => ({
          taskKey: dependency.taskKey,
          dependsOnKey: dependency.dependsOnKey,
          type: this.dependencyType(dependency.type),
          notes: dependency.notes ?? null,
        }))
        .filter((dependency) => dependency.taskKey && dependency.dependsOnKey);
    }
    return this.extractDependencies(tasks);
  }

  private extractDependencies(tasks: ProjectPlanTask[]) {
    const deps: ProjectPlanDependency[] = [];
    for (const task of tasks) {
      for (const dependsOnKey of task.dependsOn ?? []) {
        deps.push({
          taskKey: task.key,
          dependsOnKey,
          type: 'blocks',
          notes: null,
        });
      }
    }
    return deps;
  }

  private textToList(value: string | null | undefined): string[] {
    if (!value?.trim()) return [];
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private recordToList(value: Record<string, unknown> | null | undefined) {
    if (!value) return [];
    return Object.entries(value)
      .flatMap(([key, entry]) => {
        if (Array.isArray(entry)) return entry.map((item) => String(item));
        if (typeof entry === 'string') return [entry];
        if (typeof entry === 'boolean' && entry) return [key];
        return [];
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private specSection(
    value: Record<string, unknown> | null | undefined,
    fallback?: Record<string, unknown>,
  ) {
    if (value && Object.keys(value).length) return value;
    return fallback ?? null;
  }

  private dependencyType(value: string | undefined) {
    return value && ['blocks', 'related', 'after'].includes(value)
      ? value
      : 'blocks';
  }

  private async assertMaterializationReplaceable(
    manager: EntityManager,
    projectId: string,
  ) {
    const held = await manager
      .createQueryBuilder(Project, 'p')
      .select('p.held_amount', 'heldAmount')
      .where('p.id = :projectId', { projectId })
      .getRawOne<{ heldAmount: string }>();
    if (held && Number(held.heldAmount) > 0) {
      throw new BadRequestException(
        'Cannot replace a materialized plan while funds are held in escrow',
      );
    }

    const startedTaskCount = await manager
      .getRepository(ProjectTask)
      .createQueryBuilder('task')
      .where('task.project_id = :projectId', { projectId })
      .andWhere(
        "(task.assigned_freelancer_profile_id IS NOT NULL OR task.status NOT IN ('todo', 'blocked'))",
      )
      .getCount();
    const submissionCount = await manager.count(ProjectSubmission, {
      where: { projectId },
    });
    const revisionCount = await manager.count(ProjectRevisionRequest, {
      where: { projectId },
    });
    const releaseCount = await manager.count(PaymentReleaseRequest, {
      where: { projectId },
    });
    if (startedTaskCount || submissionCount || revisionCount || releaseCount) {
      throw new ConflictException(
        'Cannot replace a materialized plan after assignment or delivery work has started',
      );
    }
  }

  private async taskCountsByMilestone(projectId: string) {
    const counts = new Map<string, number>();
    const rows = await this.taskRepo
      .createQueryBuilder('t')
      .select('t.milestone_id', 'milestoneId')
      .addSelect('COUNT(*)', 'count')
      .where('t.project_id = :projectId', { projectId })
      .andWhere('t.milestone_id IS NOT NULL')
      .groupBy('t.milestone_id')
      .getRawMany<{ milestoneId: string; count: string }>();
    for (const row of rows) counts.set(row.milestoneId, Number(row.count));
    return counts;
  }

  private async assertDependenciesDone(
    taskId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const blocking = await manager
      .getRepository(ProjectTask)
      .createQueryBuilder('t')
      .innerJoin(
        ProjectTaskDependency,
        'd',
        'd.depends_on_task_id = t.id AND d.task_id = :taskId',
        { taskId },
      )
      .where('t.status != :done', { done: 'done' })
      .andWhere("d.dependency_type IN ('blocks', 'after')")
      .getCount();
    if (blocking > 0) {
      throw new BadRequestException(
        'This task is blocked by unfinished dependencies',
      );
    }
  }

  private async assertProjectVisibility(
    project: Project,
    requester: Requester,
  ) {
    if (requester.role === UserRole.ADMIN) return;

    if (requester.role === UserRole.CUSTOMER) {
      if (project.customerId !== requester.userId) {
        throw new ForbiddenException('You can only access your own project');
      }
      return;
    }

    if (requester.role === UserRole.FREELANCER) {
      const profile = await this.profileRepo.findOne({
        where: { userId: requester.userId },
        select: { id: true },
      });
      if (!profile) {
        throw new ForbiddenException('You are not assigned to this project');
      }

      const assignment = await this.assignmentRepo.findOne({
        where: {
          projectId: project.id,
          freelancerProfileId: profile.id,
          status: In(['assigned', 'accepted', 'in_progress', 'completed']),
        },
        select: { id: true },
      });
      const implementationTask = await this.taskRepo.exist({
        where: {
          projectId: project.id,
          assignedFreelancerProfileId: profile.id,
        },
      });
      if (!assignment && !implementationTask) {
        throw new ForbiddenException('You are not assigned to this project');
      }
    }
  }

  private async getProject(projectId: string) {
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private jsonLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
  }

  // acceptance criteria are stored in jsonb columns; keep them as string arrays.
  private toJsonList(
    value: string[] | undefined | null,
  ): Record<string, unknown> | null {
    return (value && value.length ? value : null) as unknown as Record<
      string,
      unknown
    > | null;
  }

  // jsonb columns are typed as objects but legitimately hold arrays here.
  private toJson(value: unknown): Record<string, unknown> | null {
    return (value ?? null) as Record<string, unknown> | null;
  }
}
