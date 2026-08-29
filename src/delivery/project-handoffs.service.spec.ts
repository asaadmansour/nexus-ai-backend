import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProjectHandoffsService } from './project-handoffs.service';

describe('ProjectHandoffsService', () => {
  const project = {
    id: 'project-1',
    customerId: 'customer-1',
    title: 'Verified delivery',
    status: 'under_review',
    currency: 'EGP',
    quotedCurrency: 'EGP',
  };

  function setup() {
    const handoff = {
      id: 'handoff-1',
      projectId: project.id,
      status: 'client_review',
      integrationBranch: 'main',
      integrationCommitSha: 'a'.repeat(40),
      verificationReport: { recommendation: 'approve', score: 95 },
      metadata: {},
    };
    const userRepository = { find: jest.fn().mockResolvedValue([]) };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(userRepository),
      transaction: jest.fn(),
    };
    const projects = {
      findOne: jest.fn().mockResolvedValue({ ...project }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const handoffs = {
      findOne: jest.fn().mockResolvedValue(handoff),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const payments = {
      completeProjectDelivery: jest.fn().mockResolvedValue({
        project: { ...project, status: 'completed' },
      }),
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const github = {
      getPullRequest: jest.fn(),
      isCommitAncestor: jest.fn(),
      syncPullRequestWithBase: jest.fn(),
    };
    const evaluations = {
      requeueForRepositoryUpdate: jest.fn(),
    };
    const submissionQuery = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const submissions = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(submissionQuery),
      save: jest.fn(),
    };
    const tasks = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    const service = new ProjectHandoffsService(
      dataSource as never,
      { get: jest.fn() } as never,
      github as never,
      {} as never,
      evaluations as never,
      notifications as never,
      payments as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      handoffs as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      projects as never,
      tasks as never,
      submissions as never,
      {} as never,
    );
    return {
      service,
      handoff,
      handoffs,
      payments,
      projects,
      notifications,
      github,
      evaluations,
      submissions,
      submissionQuery,
      tasks,
    };
  }

  it('normalizes nullable legacy brief criteria for final verification', () => {
    const { service } = setup();
    type FinalEvaluationDtoBuilder = (
      handoff: Record<string, unknown>,
      tasks: Record<string, unknown>[],
      commitSha: string,
      brief: Record<string, unknown>,
      spec: null,
    ) => {
      task: { acceptanceCriteria: unknown };
      brief: { acceptanceCriteria: unknown };
    };
    const typedService = service as unknown as {
      finalEvaluationDto: FinalEvaluationDtoBuilder;
    };

    const dto = typedService.finalEvaluationDto(
      {
        id: 'handoff-1',
        projectId: 'project-1',
        project: { title: 'Legacy brief project' },
        repositoryId: 'repository-1',
        repository: null,
        summary: 'Integrated delivery',
      },
      [],
      'a'.repeat(40),
      { acceptanceCriteria: null },
      null,
    );

    expect(dto.task.acceptanceCriteria).toEqual([]);
    expect(dto.brief.acceptanceCriteria).toEqual([]);
  });

  it('recovers a conflict-resolution commit without restarting the task flow', async () => {
    const { service, github, evaluations } = setup();
    const previousCommitSha = 'a'.repeat(40);
    const updatedCommitSha = 'b'.repeat(40);
    github.getPullRequest.mockResolvedValue({
      headSha: updatedCommitSha,
    });
    github.isCommitAncestor.mockResolvedValue(true);
    evaluations.requeueForRepositoryUpdate.mockResolvedValue({
      evaluationRunId: 'run-id',
    });
    const recover = Reflect.get(
      service,
      'recoverApprovedIntegrationUpdate',
    ) as (submission: Record<string, unknown>) => Promise<boolean>;

    await expect(
      recover.call(service, {
        id: 'submission-id',
        commitSha: previousCommitSha,
        pullRequestUrl: 'https://github.com/nexus-ai/project/pull/2',
        repository: {
          owner: 'nexus-ai',
          repoName: 'project',
        },
      }),
    ).resolves.toBe(true);
    expect(github.isCommitAncestor).toHaveBeenCalledWith({
      owner: 'nexus-ai',
      repoName: 'project',
      ancestorSha: previousCommitSha,
      descendantSha: updatedCommitSha,
    });
    expect(evaluations.requeueForRepositoryUpdate).toHaveBeenCalledWith({
      submissionId: 'submission-id',
      commitSha: updatedCommitSha,
      reason: 'integration_reconciler_pull_request_update',
      allowApprovedIntegrationRecovery: true,
    });
  });

  it('closes a task only after its approved submission is integrated', async () => {
    const { service, tasks } = setup();
    const markIntegrated = Reflect.get(
      service,
      'markSubmissionTaskIntegrated',
    ) as (submission: Record<string, unknown>) => Promise<void>;

    await markIntegrated.call(service, {
      taskId: 'task-id',
      milestoneId: null,
    });

    expect(tasks.update).toHaveBeenCalledWith('task-id', {
      status: 'done',
      assignmentStatus: 'completed',
    });
  });

  it('keeps polling an integration failure after its notification was sent', async () => {
    const {
      service,
      github,
      evaluations,
      submissions,
      submissionQuery,
      notifications,
    } = setup();
    const previousCommitSha = 'a'.repeat(40);
    const updatedCommitSha = 'b'.repeat(40);
    submissionQuery.getMany.mockResolvedValue([
      {
        id: 'submission-id',
        projectId: 'project-1',
        status: 'approved',
        commitSha: previousCommitSha,
        pullRequestUrl: 'https://github.com/nexus-ai/project/pull/2',
        metadata: {
          integration: {
            status: 'failed',
            freelancerNotifiedAt: '2026-08-29T13:00:00.000Z',
          },
        },
        repository: {
          owner: 'nexus-ai',
          repoName: 'project',
        },
      },
    ]);
    github.getPullRequest.mockResolvedValue({ headSha: updatedCommitSha });
    github.isCommitAncestor.mockResolvedValue(true);
    evaluations.requeueForRepositoryUpdate.mockResolvedValue({
      evaluationRunId: 'run-id',
    });
    const reconcile = Reflect.get(
      service,
      'reconcileSubmissionIntegrationFailures',
    ) as () => Promise<void>;

    await reconcile.call(service);

    expect(evaluations.requeueForRepositoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 'submission-id',
        commitSha: updatedCommitSha,
      }),
    );
    expect(notifications.createNotification).not.toHaveBeenCalled();
    expect(submissions.save).not.toHaveBeenCalled();
  });

  it('polls an in-review pull request when its webhook is unavailable', async () => {
    const { service, github, evaluations, submissionQuery } = setup();
    const previousCommitSha = 'a'.repeat(40);
    const updatedCommitSha = 'b'.repeat(40);
    submissionQuery.getMany.mockResolvedValue([
      {
        id: 'submission-id',
        status: 'under_review',
        submissionType: 'pull_request',
        commitSha: previousCommitSha,
        pullRequestUrl: 'https://github.com/nexus-ai/project/pull/3',
        repository: {
          owner: 'nexus-ai',
          repoName: 'project',
        },
      },
    ]);
    github.getPullRequest.mockResolvedValue({ headSha: updatedCommitSha });
    evaluations.requeueForRepositoryUpdate.mockResolvedValue({
      evaluationRunId: 'run-id',
    });
    const reconcile = Reflect.get(
      service,
      'reconcileActivePullRequestUpdates',
    ) as () => Promise<void>;

    await reconcile.call(service);

    expect(evaluations.requeueForRepositoryUpdate).toHaveBeenCalledWith({
      submissionId: 'submission-id',
      commitSha: updatedCommitSha,
      reason: 'evaluation_reconciler_pull_request_update',
    });
  });

  it('proactively updates a clean feature branch when main advances', async () => {
    const { service, github, submissions, submissionQuery } = setup();
    const commitSha = 'a'.repeat(40);
    const baseSha = 'b'.repeat(40);
    const submission = {
      id: 'submission-id',
      projectId: 'project-id',
      status: 'under_review',
      submissionType: 'pull_request',
      commitSha,
      pullRequestUrl: 'https://github.com/nexus-ai/project/pull/3',
      metadata: {} as Record<string, unknown>,
      repository: {
        owner: 'nexus-ai',
        repoName: 'project',
        defaultBranch: 'main',
      },
    };
    submissionQuery.getMany.mockResolvedValue([submission]);
    github.getPullRequest.mockResolvedValue({
      headSha: commitSha,
      baseSha,
    });
    github.syncPullRequestWithBase.mockResolvedValue({
      status: 'update_requested',
      message: 'Updating pull request branch',
      headSha: commitSha,
      baseSha,
    });
    const reconcile = Reflect.get(
      service,
      'reconcileActivePullRequestUpdates',
    ) as () => Promise<void>;

    await reconcile.call(service);

    expect(github.syncPullRequestWithBase).toHaveBeenCalledWith({
      owner: 'nexus-ai',
      repoName: 'project',
      number: 3,
      expectedHeadSha: commitSha,
      requiredBaseRef: 'main',
    });
    expect(submissions.save).toHaveBeenCalledWith(submission);
    const branchSync = submission.metadata.branchSync;
    if (!branchSync || typeof branchSync !== 'object') {
      throw new Error('Expected branch synchronization metadata');
    }
    expect((branchSync as Record<string, unknown>).status).toBe(
      'update_requested',
    );
    expect((branchSync as Record<string, unknown>).headSha).toBe(commitSha);
    expect((branchSync as Record<string, unknown>).baseSha).toBe(baseSha);
  });

  it('does not mark the handoff accepted when escrow finalization fails', async () => {
    const { service, handoff, handoffs, payments } = setup();
    payments.completeProjectDelivery.mockRejectedValueOnce(
      new ConflictException('Escrow allocation mismatch'),
    );

    await expect(
      service.clientDecision(
        project.id,
        { decision: 'accepted' },
        project.customerId,
      ),
    ).rejects.toThrow('Escrow allocation mismatch');

    expect(handoffs.save).not.toHaveBeenCalled();
    expect(handoff.status).toBe('client_review');
  });

  it('completes payment before persisting final client acceptance', async () => {
    const { service, handoff, handoffs, payments } = setup();

    await service.clientDecision(
      project.id,
      { decision: 'accepted', feedback: 'Everything matches the brief.' },
      project.customerId,
    );

    expect(payments.completeProjectDelivery).toHaveBeenCalledWith(
      project.id,
      project.customerId,
    );
    expect(handoffs.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
    );
    expect(handoff.status).toBe('accepted');
    expect(handoff.clientAcceptedAt).toBeInstanceOf(Date);
  });

  it('blocks a principal handoff when final verification did not approve it', async () => {
    const { service, handoff, handoffs } = setup();
    handoff.status = 'reviewer_review';
    handoff.verificationReport = {
      recommendation: 'changes_requested',
      score: 55,
    };

    await expect(
      service.review(project.id, { decision: 'approved' }, 'reviewer-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(handoffs.save).not.toHaveBeenCalled();
  });

  it('requires an explicit summary and only the evidence selected in the delivery contract', async () => {
    const { service, handoff, handoffs } = setup();
    handoff.status = 'reviewer_review';
    handoff.metadata = {
      deliveryContract: {
        verifiedAt: '2026-08-29T18:00:00.000Z',
        responsibilityVersion: 1,
        evidenceRequirements: {
          liveUrl: true,
          artifactUrls: false,
          sourceArchive: true,
        },
      },
    };

    await expect(
      service.review(project.id, { decision: 'approved' }, 'reviewer-1'),
    ).rejects.toThrow(
      'Add a client-facing delivery summary of at least 20 characters',
    );

    await expect(
      service.review(
        project.id,
        {
          decision: 'approved',
          summary: 'The complete integrated project is ready for review.',
        },
        'reviewer-1',
      ),
    ).rejects.toThrow(
      'This delivery contract requires a client-accessible live URL',
    );
    expect(handoffs.save).not.toHaveBeenCalled();
  });

  it('allows a source-only delivery without unrelated live or artifact URLs', async () => {
    const { service, handoff, handoffs } = setup();
    handoff.status = 'reviewer_review';
    handoff.metadata = {
      deliveryContract: {
        verifiedAt: '2026-08-29T18:00:00.000Z',
        responsibilityVersion: 1,
        evidenceRequirements: {
          liveUrl: false,
          artifactUrls: false,
          sourceArchive: true,
        },
      },
    };

    await expect(
      service.review(
        project.id,
        {
          decision: 'approved',
          summary: 'The verified source delivery is ready for client review.',
        },
        'reviewer-1',
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 'client_review' }));
    expect(handoffs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'client_review',
        liveUrl: null,
        artifactUrls: [],
      }),
    );
  });

  it('validates client rating categories before recording a review', async () => {
    const { service, handoff } = setup();
    handoff.status = 'accepted';

    await expect(
      service.rateContributor(
        project.id,
        {
          ratedUserId: '11111111-1111-4111-8111-111111111111',
          rating: 5,
          categoryRatings: { speed: 5 },
        },
        project.customerId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
