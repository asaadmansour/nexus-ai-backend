import {
  BadRequestException,
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
import { ProjectTaskDependency } from 'src/projects/entities/project-task-dependency.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { ProjectStatusHistory } from 'src/projects/entities/project-status-history.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { GeneratePlanDto } from './dtos/generate-plan.dto';
import { ReviewPlanDto } from './dtos/review-plan.dto';
import { MaterializePlanDto } from './dtos/materialize-plan.dto';
import { UpdateTaskDto } from './dtos/update-task.dto';

interface Requester {
  userId: string;
  role: UserRole;
}

@Injectable()
export class ProjectPlansService {
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
    private readonly dataSource: DataSource,
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

    const generated = await this.aiService.generateProjectPlan({
      projectId,
      projectPlanJobId: this.buildPlanJobId(projectId, architecture.id, uiux.id),
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
      brief: this.buildBriefForPlanning(brief),
      architectureSubmission: {
        id: architecture.id,
        summary: architecture.summary,
        content: architecture.content ?? {},
      },
      uiuxSubmission: {
        id: uiux.id,
        summary: uiux.summary,
        content: uiux.content ?? {},
      },
      planningTeam,
      notes: dto.notes,
    });

    const plan = await this.dataSource.transaction(async (manager) => {
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
          milestones: this.toJson(generated.milestones),
          tasks: this.toJson(generated.tasks),
          dependencies: this.toJson(
            generated.dependencies.length
              ? generated.dependencies
              : this.extractDependencies(generated.tasks),
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
      milestoneCount: generated.milestones.length,
      taskCount: generated.tasks.length,
      createdAt: plan.createdAt,
    };
  }


  async enqueueAutomaticGeneration(projectId: string, adminUserId: string) {
    const architecture = await this.resolveApprovedSubmission(
      projectId,
      'architecture',
    );
    const uiux = await this.resolveApprovedSubmission(projectId, 'ui_ux');

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
      return {
        queued: false,
        reason: 'generation_already_queued',
        agentJobId: existingJob.id,
        queueName: existingJob.queueName,
      };
    }

    const agentJob = await this.aiJobsProducer.emitProjectPlanGenerationRequested(
      {
        projectId,
        architectureSubmissionId: architecture.id,
        uiuxSubmissionId: uiux.id,
        requestedBy: adminUserId,
        notes: 'Automatic scrum plan generation after architecture and UI/UX approval.',
      },
    );

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

    if (requester.role === UserRole.CUSTOMER) {
      const project = await this.getProject(plan.projectId);
      await this.assertProjectVisibility(project, requester);
      if (plan.status !== 'approved') {
        throw new ForbiddenException('This plan is not available yet');
      }
    }

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
      milestones: plan.milestones,
      tasks: plan.tasks,
      dependencies: plan.dependencies,
      projectSpec: plan.projectSpec,
      teamPlan: plan.teamPlan,
      riskRegister: plan.riskRegister,
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

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    plan.status = dto.status;
    plan.adminNotes = dto.adminNotes ?? plan.adminNotes ?? null;
    if (dto.status === 'approved') {
      plan.approvedBy = adminUserId;
      plan.approvedAt = new Date();
    }
    await this.planRepo.save(plan);

    const response: Record<string, unknown> = {
      id: plan.id,
      status: plan.status,
      approvedBy: plan.approvedBy,
      approvedAt: plan.approvedAt,
    };

    if (dto.status === 'approved' && dto.materialize) {
      response.materialization = await this.materialize(
        planId,
        {},
        adminUserId,
      );
    }
    return response;
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

    const existingSpec = await this.specRepo.findOne({
      where: { projectId: plan.projectId },
    });
    if (existingSpec && !dto.replaceExisting) {
      return this.existingMaterializationCounts(
        plan.projectId,
        existingSpec.id,
      );
    }

    const milestones = (plan.milestones ??
      []) as unknown as ProjectPlanMilestone[];
    const tasks = (plan.tasks ?? []) as unknown as ProjectPlanTask[];
    const dependencies = this.planDependencies(plan.dependencies, tasks);
    const projectSpec = (plan.projectSpec ?? {}) as ProjectPlanSpec;

    return this.dataSource.transaction(async (manager) => {
      if (existingSpec && dto.replaceExisting) {
        await this.assertNoActivePayments(manager, plan.projectId);
        await manager.delete(ProjectTask, { projectId: plan.projectId });
        await manager.delete(ProjectMilestone, { projectId: plan.projectId });
        await manager.delete(ProjectSpec, { projectId: plan.projectId });
      }

      const milestoneIdByKey = new Map<string, string>();
      let quotedAmount = 0;
      let quotedCurrency: string | null = null;
      for (const milestone of milestones) {
        const milestoneBudgetAmount =
          milestone.budgetAmount != null ? Number(milestone.budgetAmount) : null;
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
        const saved = await manager.save(
          ProjectTask,
          manager.create(ProjectTask, {
            projectId: plan.projectId,
            projectPlanId: plan.id,
            milestoneId: milestoneIdByKey.get(task.milestoneKey) ?? null,
            title: task.title,
            description: task.description ?? null,
            status: 'todo',
            priority: task.priority ?? 'medium',
            roleKey: task.roleKey ?? null,
            requiredSkills: task.requiredSkills ?? null,
            estimatedHours:
              task.estimatedHours != null ? String(task.estimatedHours) : null,
            orderIndex: task.orderIndex ?? 0,
            acceptanceCriteria: this.toJsonList(task.acceptanceCriteria),
          }),
        );
        taskIdByKey.set(task.key, saved.id);
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

      const project = await manager.findOne(Project, {
        where: { id: plan.projectId },
      });
      if (project) {
        const oldStatus = project.status;
        const quote = this.buildProjectQuote(
          project,
          quotedAmount,
          quotedCurrency,
        );
        project.quotedAmount = quote.amount;
        project.quotedCurrency = quote.currency;
        project.quoteStatus = quote.status;
        project.quoteGeneratedAt = quote.generatedAt;
        project.quoteNotes = quote.notes;
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
      };
    });
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

    const data = tasks.map((task) => ({
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
      orderIndex: task.orderIndex,
      startsAt: task.startsAt,
      dueAt: task.dueAt,
      acceptanceCriteria: task.acceptanceCriteria,
      dependencies: (task.dependencies ?? []).map((dep) => ({
        taskId: dep.taskId,
        dependsOnTaskId: dep.dependsOnTaskId,
        dependencyType: dep.dependencyType,
        notes: dep.notes,
      })),
    }));
    return { data, total };
  }

  async updateTask(taskId: string, dto: UpdateTaskDto, requester: Requester) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    const isAdmin = requester.role === UserRole.ADMIN;
    if (!isAdmin) {
      const profile = await this.profileRepo.findOne({
        where: { userId: requester.userId },
      });
      if (!profile || task.assignedFreelancerProfileId !== profile.id) {
        throw new ForbiddenException('You can only update your own task');
      }
      if (dto.assignedFreelancerProfileId || dto.assignmentId) {
        throw new ForbiddenException('You cannot reassign a task');
      }
    }

    if (dto.status === 'in_progress') {
      await this.assertDependenciesDone(taskId);
    }

    if (dto.status) task.status = dto.status;
    if (isAdmin && dto.assignedFreelancerProfileId !== undefined) {
      task.assignedFreelancerProfileId = dto.assignedFreelancerProfileId;
    }
    if (isAdmin && dto.assignmentId !== undefined) {
      task.assignmentId = dto.assignmentId;
    }
    await this.taskRepo.save(task);

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
    const isOutOfBudget = Number.isFinite(budgetMax) && quotedAmount > budgetMax;

    return {
      amount,
      currency,
      status: isOutOfBudget ? 'out_of_budget' : 'pending_customer',
      generatedAt: new Date(),
      notes: isOutOfBudget
        ? `The final estimate is ${amount} ${currency}, which is above the customer's maximum budget of ${project.budgetMax} ${project.currency}. Ask the customer to revise the budget range before payment.`
        : 'Final estimate generated from the approved Scrum Master milestone plan.',
    };
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
        .filter(
          (dependency) => dependency.taskKey && dependency.dependsOnKey,
        );
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

  private async existingMaterializationCounts(
    projectId: string,
    specId: string,
  ) {
    const [milestoneCount, taskCount] = await Promise.all([
      this.milestoneRepo.count({ where: { projectId } }),
      this.taskRepo.count({ where: { projectId } }),
    ]);
    return {
      projectId,
      specId,
      projectStatus: ProjectStatus.IMPLEMENTATION_READY,
      planningStatus: 'completed',
      milestoneCount,
      taskCount,
      alreadyMaterialized: true,
    };
  }

  private async assertNoActivePayments(
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

  private async assertDependenciesDone(taskId: string) {
    const blocking = await this.taskRepo
      .createQueryBuilder('t')
      .innerJoin(
        ProjectTaskDependency,
        'd',
        'd.depends_on_task_id = t.id AND d.task_id = :taskId',
        { taskId },
      )
      .where('t.status != :done', { done: 'done' })
      .getCount();
    if (blocking > 0) {
      throw new BadRequestException(
        'This task is blocked by unfinished dependencies',
      );
    }
  }

  private async assertProjectVisibility(project: Project, requester: Requester) {
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
      if (!assignment) {
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
