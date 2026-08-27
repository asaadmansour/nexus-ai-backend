import {
  canFreelancerTransitionTask,
  ProjectPlansService,
} from './project-plans.service';

describe('Sprint 5 task workflow', () => {
  it('allows freelancers to start and block their own work', () => {
    expect(canFreelancerTransitionTask('todo', 'in_progress')).toBe(true);
    expect(canFreelancerTransitionTask('in_progress', 'blocked')).toBe(true);
    expect(
      canFreelancerTransitionTask('changes_requested', 'in_progress'),
    ).toBe(true);
  });

  it('does not let freelancers bypass submission review states', () => {
    expect(canFreelancerTransitionTask('todo', 'done')).toBe(false);
    expect(canFreelancerTransitionTask('in_progress', 'review')).toBe(false);
    expect(canFreelancerTransitionTask('review', 'in_progress')).toBe(false);
  });

  it('lists only the signed-in freelancer tasks with project and budget context', async () => {
    const profileRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    };
    const taskRepo = {
      findAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'task-1',
            projectId: 'project-1',
            projectPlanId: 'plan-1',
            milestoneId: 'milestone-1',
            assignmentId: 'assignment-1',
            assignedFreelancerProfileId: 'profile-1',
            title: 'Build the API',
            description: null,
            status: 'todo',
            priority: 'high',
            roleKey: 'backend',
            requiredSkills: ['NestJS'],
            estimatedHours: '8.00',
            budgetAmount: '1200.00',
            currency: 'EGP',
            orderIndex: 1,
            startsAt: null,
            dueAt: null,
            acceptanceCriteria: ['Contract tests pass'],
            metadata: {},
            sourceMatchingRunId: 'run-1',
            sourceCandidateId: 'candidate-1',
            assignedBy: 'admin-1',
            assignedAt: new Date('2026-01-01T00:00:00Z'),
            project: {
              id: 'project-1',
              title: 'Nexus',
              status: 'in_progress',
              currency: 'EGP',
            },
            milestone: {
              id: 'milestone-1',
              title: 'API foundation',
              status: 'planned',
            },
            dependencies: [],
          },
        ],
        1,
      ]),
    };
    const service = Object.assign(
      Object.create(ProjectPlansService.prototype),
      {
        profileRepo,
        taskRepo,
      },
    ) as ProjectPlansService;

    const result = await service.listAssignedFreelancerTasks('user-1', {
      page: 1,
      limit: 50,
    });

    expect(profileRepo.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(taskRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedFreelancerProfileId: 'profile-1' },
        relations: ['dependencies', 'project', 'milestone'],
      }),
    );
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: 'task-1',
      budgetAmount: '1200.00',
      currency: 'EGP',
      project: { id: 'project-1', title: 'Nexus' },
      milestone: { id: 'milestone-1', title: 'API foundation' },
    });
  });

  it('recovers approved plans that were stranded before task materialization', async () => {
    const getMany = jest.fn().mockResolvedValue([
      {
        id: 'plan-1',
        projectId: 'project-1',
        approvedBy: 'reviewer-1',
      },
    ]);
    const queryBuilder: Record<string, jest.Mock> = {};
    for (const method of [
      'leftJoin',
      'where',
      'andWhere',
      'orderBy',
      'limit',
    ]) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.getMany = getMany;
    const materialize = jest.fn().mockResolvedValue({ taskCount: 1 });
    const service = Object.assign(
      Object.create(ProjectPlansService.prototype),
      {
        planRepo: {
          createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        },
        materialize,
      },
    ) as ProjectPlansService;

    const result = await service.recoverApprovedUnmaterializedPlans();

    expect(materialize).toHaveBeenCalledWith('plan-1', {}, 'reviewer-1');
    expect(result).toEqual({
      inspected: 1,
      recovered: 1,
      recoveredProjectIds: ['project-1'],
      failures: [],
    });
  });

  it('queues a revised plan with the reviewer change request as guidance', async () => {
    const plan = {
      id: 'plan-1',
      projectId: 'project-1',
      architectureSubmissionId: 'architecture-1',
      uiuxSubmissionId: 'uiux-1',
      status: 'generated',
      isCurrent: true,
      adminNotes: null,
      approvedBy: null,
      approvedAt: null,
    };
    const queryBuilder: Record<string, jest.Mock> = {};
    for (const method of ['setLock', 'where']) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.getOne = jest.fn().mockResolvedValue(plan);
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      }),
      save: jest.fn().mockResolvedValue(plan),
    };
    const transaction = jest.fn(
      (callback: (transactionManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );
    const enqueueAutomaticGeneration = jest.fn().mockResolvedValue({
      queued: true,
      agentJobId: 'job-2',
      queueName: 'project-plan-generation',
    });
    const resolveOperation = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(
      Object.create(ProjectPlansService.prototype),
      {
        dataSource: { transaction },
        enqueueAutomaticGeneration,
        incidents: { resolveOperation },
        logger: { warn: jest.fn(), error: jest.fn() },
      },
    ) as ProjectPlansService;

    const result = await service.review(
      'plan-1',
      {
        status: 'changes_requested',
        adminNotes: 'Divide implementation across three freelancers.',
      },
      'reviewer-1',
    );

    expect(enqueueAutomaticGeneration).toHaveBeenCalledWith(
      'project-1',
      'reviewer-1',
      {
        architectureSubmissionId: 'architecture-1',
        uiuxSubmissionId: 'uiux-1',
        notes: 'Divide implementation across three freelancers.',
      },
    );
    expect(plan.status).toBe('changes_requested');
    expect(plan.adminNotes).toBe(
      'Divide implementation across three freelancers.',
    );
    expect(result).toMatchObject({
      id: 'plan-1',
      status: 'changes_requested',
      regeneration: { queued: true, agentJobId: 'job-2' },
    });
  });

  it('reconciles plans already stranded in changes_requested', async () => {
    const enqueueAutomaticGeneration = jest.fn().mockResolvedValue({
      queued: true,
      agentJobId: 'job-2',
    });
    const service = Object.assign(
      Object.create(ProjectPlansService.prototype),
      {
        projectRepo: {
          find: jest.fn().mockResolvedValue([{ id: 'project-1' }]),
        },
        planRepo: {
          findOne: jest.fn().mockResolvedValue({
            id: 'plan-1',
            projectId: 'project-1',
            status: 'changes_requested',
            isCurrent: true,
            adminNotes: 'Use three implementation freelancers.',
          }),
        },
        submissionRepo: {
          findOne: jest
            .fn()
            .mockResolvedValueOnce({
              id: 'architecture-1',
              reviewedBy: 'reviewer-1',
            })
            .mockResolvedValueOnce({
              id: 'uiux-1',
              reviewedBy: 'reviewer-1',
            }),
        },
        enqueueAutomaticGeneration,
        incidents: { resolveOperation: jest.fn().mockResolvedValue(undefined) },
        logger: { warn: jest.fn(), error: jest.fn() },
      },
    ) as ProjectPlansService;

    await expect(service.recoverMissingPlanGenerations()).resolves.toEqual({
      inspected: 1,
      queued: 1,
      queuedProjectIds: ['project-1'],
      failures: [],
    });
    expect(enqueueAutomaticGeneration).toHaveBeenCalledWith(
      'project-1',
      'reviewer-1',
      {
        architectureSubmissionId: 'architecture-1',
        uiuxSubmissionId: 'uiux-1',
        notes: 'Use three implementation freelancers.',
      },
    );
  });

  it('notifies the principal reviewer when the revised plan is ready', async () => {
    const ensureProjectPlanReviewNotification = jest
      .fn()
      .mockResolvedValue(undefined);
    const service = Object.assign(
      Object.create(ProjectPlansService.prototype),
      {
        resolveApprovedSubmission: jest
          .fn()
          .mockResolvedValueOnce({ id: 'architecture-1' })
          .mockResolvedValueOnce({ id: 'uiux-1' }),
        findCurrentPlanForInputs: jest.fn().mockResolvedValue({
          id: 'plan-2',
          projectId: 'project-1',
          version: 2,
        }),
        markPlanJobRunning: jest.fn().mockResolvedValue(undefined),
        markPlanJobCompleted: jest.fn().mockResolvedValue(undefined),
        resolvePlanGenerationIncident: jest.fn().mockResolvedValue(undefined),
        assignmentRepo: {
          findOne: jest.fn().mockResolvedValue({
            freelancerProfile: { userId: 'reviewer-1' },
          }),
        },
        notificationsService: { ensureProjectPlanReviewNotification },
      },
    ) as ProjectPlansService;

    await service.processQueuedGeneration(
      {
        agentJobId: 'job-2',
        projectId: 'project-1',
        architectureSubmissionId: 'architecture-1',
        uiuxSubmissionId: 'uiux-1',
        requestedBy: 'reviewer-1',
        notes: 'Use three implementation freelancers.',
      },
      0,
    );

    expect(ensureProjectPlanReviewNotification).toHaveBeenCalledWith(
      'plan-2',
      expect.objectContaining({
        userId: 'reviewer-1',
        projectId: 'project-1',
        actionUrl: '/reviewer/projects/project-1',
      }),
    );
  });
});
