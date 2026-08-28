import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertTaskMatchingRunInvariant,
  MatchingService,
  completedEmptyRunIsCoolingDown,
  hasTaskCapacity,
  MAX_ACTIVE_TASKS_PER_FREELANCER,
  ROLE_FILLED_STATUSES,
  requiresReviewerCandidateSelection,
  resolveInvitationTtlHours,
  staffingFailureIsCoolingDown,
} from './matching.service';
import { createProjectBudgetAllocation } from 'src/planning/project-budget-allocation';

describe('MatchingService task assignment invariants', () => {
  const task = { id: 'task-a', projectId: 'project-a' };

  it('rejects a candidate run from another task', () => {
    expect(() =>
      assertTaskMatchingRunInvariant(
        {
          targetType: 'task',
          targetTaskId: 'task-b',
          projectId: 'project-a',
          status: 'completed',
        },
        task,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a task run before ranking completes', () => {
    expect(() =>
      assertTaskMatchingRunInvariant(
        {
          targetType: 'task',
          targetTaskId: 'task-a',
          projectId: 'project-a',
          status: 'running',
        },
        task,
      ),
    ).toThrow(ConflictException);
  });

  it('accepts a completed run for the exact task and project', () => {
    expect(() =>
      assertTaskMatchingRunInvariant(
        {
          targetType: 'task',
          targetTaskId: 'task-a',
          projectId: 'project-a',
          status: 'completed',
        },
        task,
      ),
    ).not.toThrow();
  });

  it('keeps principal-reviewer matching automatic but routes every other role through reviewer selection', () => {
    expect(requiresReviewerCandidateSelection('principal_reviewer')).toBe(
      false,
    );
    expect(requiresReviewerCandidateSelection('architect')).toBe(true);
    expect(requiresReviewerCandidateSelection('ui_ux')).toBe(true);
    expect(requiresReviewerCandidateSelection('frontend')).toBe(true);
  });

  it('defaults project invitations to the configured five-hour staffing window', () => {
    expect(resolveInvitationTtlHours(undefined)).toBe(5);
    expect(resolveInvitationTtlHours('')).toBe(5);
    expect(resolveInvitationTtlHours('0')).toBe(5);
    expect(resolveInvitationTtlHours('6')).toBe(6);
  });

  it('allows up to three active implementation tasks or reservations globally', () => {
    expect(MAX_ACTIVE_TASKS_PER_FREELANCER).toBe(3);
    expect(hasTaskCapacity(0, 0)).toBe(true);
    expect(hasTaskCapacity(2, 0)).toBe(true);
    expect(hasTaskCapacity(1, 1)).toBe(true);
    expect(hasTaskCapacity(2, 1)).toBe(false);
    expect(hasTaskCapacity(3, 0)).toBe(false);
  });

  it('does not reopen staffing for a completed project role', () => {
    expect(ROLE_FILLED_STATUSES).toEqual([
      'assigned',
      'accepted',
      'in_progress',
      'completed',
    ]);
  });

  it('backs off briefly before retrying an empty completed shortlist', () => {
    const now = Date.parse('2030-01-01T00:20:00.000Z');
    expect(
      completedEmptyRunIsCoolingDown(
        'completed',
        0,
        new Date('2030-01-01T00:10:00.000Z'),
        now,
        15 * 60_000,
      ),
    ).toBe(true);
    expect(
      completedEmptyRunIsCoolingDown(
        'completed',
        0,
        new Date('2030-01-01T00:00:00.000Z'),
        now,
        15 * 60_000,
      ),
    ).toBe(false);
  });

  it('does not hammer a recently blocked staffing flow every minute', () => {
    const now = Date.parse('2030-01-01T00:20:00.000Z');
    expect(
      staffingFailureIsCoolingDown(
        'staffing_blocked',
        new Date('2030-01-01T00:10:00.000Z'),
        now,
        15 * 60_000,
      ),
    ).toBe(true);
    expect(
      staffingFailureIsCoolingDown(
        'staffing_blocked',
        new Date('2030-01-01T00:00:00.000Z'),
        now,
        15 * 60_000,
      ),
    ).toBe(false);
  });

  it('limits a principal reviewer to the top three candidates', async () => {
    const inviteNextCandidate = jest.fn();
    const service = Object.assign(Object.create(MatchingService.prototype), {
      runRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'run-a',
          targetRoleKey: 'architect',
          status: 'completed',
        }),
      },
      candidateRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'candidate-four',
          matchingRunId: 'run-a',
          freelancerProfileId: 'profile-four',
          rank: 4,
        }),
      },
      inviteNextCandidate,
    }) as MatchingService;

    await expect(
      service.reviewRunWithInvitation(
        'run-a',
        { decision: 'approved', selectedCandidateId: 'candidate-four' },
        'reviewer-a',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(inviteNextCandidate).not.toHaveBeenCalled();
  });

  it('sends the selected top-three candidate through the invitation flow', async () => {
    const invitation = {
      id: 'invitation-a',
      candidateId: 'candidate-two',
      status: 'pending',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      respondedAt: null,
      responseReason: null,
    };
    const inviteNextCandidate = jest.fn().mockResolvedValue(invitation);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      runRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'run-a',
          targetRoleKey: 'ui_ux',
          status: 'completed',
        }),
      },
      candidateRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'candidate-two',
          matchingRunId: 'run-a',
          freelancerProfileId: 'profile-two',
          rank: 2,
        }),
      },
      inviteNextCandidate,
    }) as MatchingService;

    const result = await service.reviewRunWithInvitation(
      'run-a',
      { decision: 'approved', selectedCandidateId: 'candidate-two' },
      'reviewer-a',
    );

    expect(inviteNextCandidate).toHaveBeenCalledWith(
      'run-a',
      'candidate-two',
      'reviewer-a',
    );
    expect(result).toMatchObject({
      runId: 'run-a',
      status: 'reviewed',
      assignment: null,
      invitation: { id: 'invitation-a', status: 'pending' },
    });
  });

  it('recovers materialized tasks when matching never created a run', async () => {
    const queryBuilder: Record<string, jest.Mock> = {};
    for (const method of [
      'select',
      'innerJoin',
      'leftJoin',
      'where',
      'andWhere',
      'limit',
    ]) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.getRawMany = jest
      .fn()
      .mockResolvedValue([{ projectId: 'project-a' }]);
    const autoStartImplementationTasks = jest
      .fn()
      .mockResolvedValue({ triggered: true });
    const service = Object.assign(Object.create(MatchingService.prototype), {
      taskRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      },
      autoStartImplementationTasks,
    }) as MatchingService;

    const result =
      await service.recoverImplementationTasksWithoutMatchingRuns();

    expect(autoStartImplementationTasks).toHaveBeenCalledWith(
      'project-a',
      null,
    );
    expect(result).toEqual({ inspected: 1, restarted: 1 });
  });

  it('locks only the invitation row while loading notification relations', async () => {
    const invitation = {
      id: 'invitation-a',
      projectId: 'project-a',
      taskId: null,
      roleKey: 'principal_reviewer',
      phase: 'governance',
      status: 'pending',
      notificationStatus: 'pending',
      notificationAttempts: 0,
      notificationError: null,
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      expiresAt: new Date('2030-01-01T05:00:00.000Z'),
      project: { title: 'Project A' },
      task: null,
      freelancerProfile: { userId: 'user-a' },
    };
    const queryBuilder: Record<string, jest.Mock> = {};
    for (const method of ['setLock', 'leftJoinAndSelect', 'where']) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }
    queryBuilder.getOne = jest.fn().mockResolvedValue(invitation);
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      }),
      save: jest.fn().mockResolvedValue(invitation),
    };
    const ensureProjectInvitationNotification = jest
      .fn()
      .mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn(
      (callback: (transactionManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    );
    const service = Object.assign(Object.create(MatchingService.prototype), {
      invitationRepo: {
        find: jest.fn().mockResolvedValue([invitation]),
        update,
      },
      dataSource: { transaction },
      notificationsService: { ensureProjectInvitationNotification },
      logger: { warn: jest.fn() },
    }) as MatchingService;

    await expect(
      service.recoverUndeliveredInvitationNotifications(),
    ).resolves.toEqual({ inspected: 1, delivered: 1 });

    expect(queryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
      undefined,
      ['invitation'],
    );
    expect(ensureProjectInvitationNotification).toHaveBeenCalledTimes(1);
    const [updatedInvitationId, notificationUpdate] = update.mock
      .calls[0] as unknown as [
      string,
      {
        notificationStatus: string;
        notificationSentAt: Date;
        notificationError: null;
      },
    ];
    expect(updatedInvitationId).toBe('invitation-a');
    expect(notificationUpdate).toMatchObject({
      notificationStatus: 'sent',
      notificationError: null,
    });
    expect(notificationUpdate.notificationSentAt).toBeInstanceOf(Date);
  });

  it('recovers both funded stages when a process stops after recording the Stripe hold', async () => {
    const allocation = createProjectBudgetAllocation(1000, 'EGP');
    const activateFundedProject = jest.fn().mockResolvedValue(undefined);
    const activateImplementation = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      projectRepo: {
        find: jest.fn().mockResolvedValue([
          {
            id: 'planning-project',
            status: 'ready_for_funding',
            heldAmount: '500.00',
            quotedAmount: '1000.00',
            budgetAllocation: allocation,
          },
          {
            id: 'implementation-project',
            status: 'ready_for_implementation_funding',
            heldAmount: '1000.00',
            quotedAmount: '1000.00',
            budgetAllocation: allocation,
          },
        ]),
      },
      activateFundedProject,
      activateImplementation,
      logger: { error: jest.fn() },
    }) as MatchingService;

    await expect(service.recoverFundedStageActivations()).resolves.toEqual({
      inspected: 2,
      planningActivated: 1,
      implementationActivated: 1,
    });
    expect(activateFundedProject).toHaveBeenCalledWith('planning-project');
    expect(activateImplementation).toHaveBeenCalledWith(
      'implementation-project',
    );
  });

  it('shows the funding stage but keeps payment capacity-locked after the planning team accepts', async () => {
    const project = {
      id: 'project-a',
      status: 'planning_matching',
      automationStatus: 'matching_planning_team',
      automationError: null,
      automationErrorCategory: null,
      automationErrorAt: null,
    };
    const projectQuery: Record<string, jest.Mock> = {};
    for (const method of ['setLock', 'where']) {
      projectQuery[method] = jest.fn().mockReturnValue(projectQuery);
    }
    projectQuery.getOne = jest.fn().mockResolvedValue(project);
    const roleQuery: Record<string, jest.Mock> = {};
    for (const method of ['select', 'where', 'andWhere']) {
      roleQuery[method] = jest.fn().mockReturnValue(roleQuery);
    }
    roleQuery.getRawMany = jest
      .fn()
      .mockResolvedValue([{ roleKey: 'architect' }, { roleKey: 'ui_ux' }]);
    const manager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(projectQuery),
      }),
      createQueryBuilder: jest.fn().mockReturnValue(roleQuery),
      findOne: jest.fn().mockResolvedValue({ id: 'reviewer-a' }),
      exists: jest.fn().mockResolvedValue(false),
      save: jest.fn().mockResolvedValue(project),
    };
    const transitionProject = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      estimateImplementationCapacity: jest.fn().mockResolvedValue({
        status: 'unavailable',
        blockingReasons: ['No implementation candidates are available now.'],
      }),
      transitionProject,
    }) as unknown as {
      maybeAdvanceToPlanningAssigned: (
        manager: typeof manager,
        projectId: string,
        adminUserId: string | null,
      ) => Promise<boolean>;
    };

    await expect(
      service.maybeAdvanceToPlanningAssigned(manager, 'project-a', null),
    ).resolves.toBe(true);
    expect(transitionProject).toHaveBeenCalledWith(
      manager,
      project,
      null,
      expect.objectContaining({
        status: 'ready_for_funding',
        reason: expect.stringContaining('payment remains locked'),
      }),
    );
    expect(project).toMatchObject({
      automationStatus: 'ready_for_funding_capacity_at_risk',
      automationErrorCategory: 'implementation_capacity',
    });
  });

  it('periodically recovers planning funding readiness after a missed acceptance event', async () => {
    const reconcileProjectFundingReadiness = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      projectRepo: {
        find: jest
          .fn()
          .mockResolvedValue([{ id: 'project-a' }, { id: 'project-b' }]),
      },
      reconcileProjectFundingReadiness,
      logger: { error: jest.fn() },
    }) as MatchingService;

    await expect(service.recoverPlanningFundingReadiness()).resolves.toEqual({
      inspected: 2,
      unlocked: 1,
    });
    expect(reconcileProjectFundingReadiness).toHaveBeenCalledTimes(2);
  });

  it('emails the customer once limited implementation capacity becomes available', async () => {
    const updateQuery: Record<string, jest.Mock> = {};
    for (const method of [
      'update',
      'set',
      'where',
      'andWhere',
      'setParameter',
    ]) {
      updateQuery[method] = jest.fn().mockReturnValue(updateQuery);
    }
    updateQuery.execute = jest.fn().mockResolvedValue({ affected: 1 });
    const project = {
      id: 'project-a',
      status: 'ready_for_funding',
      automationStatus: 'ready_for_funding_capacity_at_risk_notified',
      implementationCapacitySnapshot: {
        status: 'unavailable',
        checkedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      },
    };
    const notifyProjectOwner = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      projectRepo: {
        find: jest.fn().mockResolvedValue([project]),
        createQueryBuilder: jest.fn().mockReturnValue(updateQuery),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      },
      estimateImplementationCapacity: jest.fn().mockResolvedValue({
        status: 'viable',
        workableCandidates: 4,
        requiredPeople: 3,
        blockingReasons: [],
      }),
      notifyProjectOwner,
      logger: { error: jest.fn() },
    }) as MatchingService;

    await expect(
      service.refreshUnavailableImplementationCapacity(),
    ).resolves.toEqual({ inspected: 1, refreshed: 1, available: 1 });
    expect(notifyProjectOwner).toHaveBeenCalledWith(
      project,
      'Capacity is available and planning is ready to fund',
      expect.stringContaining('4 workable implementation freelancer'),
      undefined,
      expect.objectContaining({
        customerActionUrl: '/projects/project-a/payments',
        customerType: 'implementation_capacity_update',
      }),
    );
  });

  it('starts architect and UI/UX matching after governance moved the project to planning matching', async () => {
    const startPlanningRoles = jest.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      dataSource: {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue({ id: 'reviewer-assignment' }),
        }),
      },
      runRepo: { find: jest.fn().mockResolvedValue([]) },
      projectRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'project-a',
          status: 'planning_matching',
        }),
      },
      startPlanningRoles,
    }) as MatchingService;

    await service.autoStartPlanningRoles('project-a');

    expect(startPlanningRoles).toHaveBeenCalledWith(
      'project-a',
      { roles: ['architect', 'ui_ux'] },
      null,
    );
  });

  it('recovers the client payment email after implementation funding unlocks', async () => {
    const project = {
      id: 'project-a',
      customerId: 'customer-a',
      status: 'ready_for_implementation_funding',
      automationStatus: 'implementation_team_ready_for_funding',
      budgetAllocation: createProjectBudgetAllocation(1000, 'EGP'),
      quotedCurrency: 'EGP',
      currency: 'EGP',
    };
    const ensureImplementationFundingReadyNotification = jest
      .fn()
      .mockResolvedValue({ id: 'notification-a' });
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = Object.assign(Object.create(MatchingService.prototype), {
      projectRepo: {
        find: jest.fn().mockResolvedValue([project]),
        update,
      },
      notificationsService: {
        ensureImplementationFundingReadyNotification,
      },
      logger: { warn: jest.fn() },
    }) as MatchingService;

    await expect(
      service.recoverImplementationFundingReadyNotifications(),
    ).resolves.toEqual({ inspected: 1, notified: 1 });
    expect(ensureImplementationFundingReadyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'customer-a',
        projectId: 'project-a',
        actionUrl: '/projects/project-a/payments',
        metadata: { fundingStage: 'implementation' },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-a',
        automationStatus: 'implementation_team_ready_for_funding',
      }),
      { automationStatus: 'implementation_team_ready_for_funding_notified' },
    );
  });

  it('recovers existing projects whose reviewer accepted before planning-role matching started', async () => {
    const autoStartPlanningRoles = jest.fn().mockResolvedValue(true);
    const service = Object.assign(Object.create(MatchingService.prototype), {
      dataSource: {
        getRepository: jest.fn().mockReturnValue({
          find: jest
            .fn()
            .mockResolvedValue([
              { projectId: 'stuck-project', status: 'accepted' },
            ]),
        }),
      },
      projectRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'stuck-project',
          status: 'planning_matching',
        }),
      },
      runRepo: { find: jest.fn().mockResolvedValue([]) },
      autoStartPlanningRoles,
    }) as MatchingService;

    const result = await service.recoverPlanningRolesAfterReviewerAcceptance();

    expect(autoStartPlanningRoles).toHaveBeenCalledWith('stuck-project');
    expect(result).toEqual({ inspected: 1, restarted: 1 });
  });

  it('recovers a principal-reviewer run committed before its invitation was persisted', async () => {
    const inviteNextCandidate = jest
      .fn()
      .mockResolvedValue({ id: 'recovered-invitation' });
    const service = Object.assign(Object.create(MatchingService.prototype), {
      dataSource: {
        getRepository: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        }),
      },
      invitationRepo: { findOne: jest.fn().mockResolvedValue(null) },
      runRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'principal-run',
          status: 'completed',
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
        }),
      },
      candidateRepo: {
        count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(2),
      },
      inviteNextCandidate,
    }) as MatchingService;

    await expect(service.autoStartPrincipalReviewer('project-a')).resolves.toBe(
      true,
    );
    expect(inviteNextCandidate).toHaveBeenCalledWith('principal-run');
  });
});
