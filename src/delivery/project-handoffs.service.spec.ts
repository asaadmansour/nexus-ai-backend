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
    };
    const evaluations = {
      requeueForRepositoryUpdate: jest.fn(),
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
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
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
    };
  }

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

  it('requires an explicit summary and accessible delivery before client handoff', async () => {
    const { service, handoff, handoffs } = setup();
    handoff.status = 'reviewer_review';

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
      'Provide a client-accessible live URL or delivery artifact before handoff',
    );
    expect(handoffs.save).not.toHaveBeenCalled();
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
