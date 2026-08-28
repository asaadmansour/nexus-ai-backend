import { RepositoriesService } from './repositories.service';

describe('RepositoriesService recovery', () => {
  it('syncs collaborator access without requiring webhook permission', async () => {
    const repository = {
      id: 'repository-a',
      projectId: 'project-a',
      owner: 'nexus-ai',
      repoName: 'project-a',
      status: 'active',
      lastSyncedAt: null,
    };
    const profile = {
      id: 'profile-a',
      userId: 'user-a',
      githubUsername: 'developer-a',
      user: { firstName: 'Developer', lastName: 'A' },
    };
    const collaborator = {
      id: 'collaborator-a',
      repositoryId: repository.id,
      projectId: repository.projectId,
      freelancerProfileId: profile.id,
      githubUsername: null,
      permission: 'push',
      inviteStatus: 'pending',
      freelancerProfile: profile,
    };
    const update = {
      set: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    update.set.mockReturnValue(update);
    update.where.mockReturnValue(update);
    update.andWhere.mockReturnValue(update);
    const syncEvaluationWebhook = jest.fn();
    const service = Object.assign(
      Object.create(RepositoriesService.prototype) as RepositoriesService,
      {
        logger: { log: jest.fn(), error: jest.fn() },
        repoRepo: { save: jest.fn().mockResolvedValue(repository) },
        collaboratorRepo: {
          createQueryBuilder: jest.fn().mockReturnValue({
            update: jest.fn().mockReturnValue(update),
          }),
          find: jest.fn().mockResolvedValue([collaborator]),
        },
        profileRepo: { find: jest.fn().mockResolvedValue([profile]) },
        findProjectRepository: jest.fn().mockResolvedValue(repository),
        resolveCollaboratorProfileIds: jest
          .fn()
          .mockResolvedValue([profile.id]),
        claimCollaboratorRow: jest.fn().mockResolvedValue(collaborator),
        sendInvite: jest.fn().mockImplementation(() => {
          collaborator.inviteStatus = 'invited';
          return collaborator;
        }),
        notifyInvite: jest.fn(),
        syncEvaluationWebhook,
      },
    );

    const result = await service.syncCollaborators(
      repository.projectId,
      { includeTaskAssignees: true },
      'admin-a',
    );

    expect(syncEvaluationWebhook).not.toHaveBeenCalled();
    expect(result).toMatchObject({ invited: 1, missingUsername: 0 });
  });

  it('resolves the webhook incident after a successful retry', async () => {
    const resolveOperation = jest.fn().mockResolvedValue(1);
    const repository = {
      id: 'repository-a',
      projectId: 'project-a',
      owner: 'nexus-ai',
      repoName: 'project-a',
      metadata: null,
    };
    const service = Object.assign(
      Object.create(RepositoriesService.prototype) as RepositoriesService,
      {
        logger: { log: jest.fn(), error: jest.fn() },
        github: {
          ensureEvaluationWebhook: jest.fn().mockResolvedValue({
            id: '42',
            url: 'https://nexus.test/api/repositories/webhooks/github',
            active: true,
          }),
        },
        incidents: { resolveOperation },
      },
    );

    await Reflect.get(service, 'syncEvaluationWebhook').call(
      service,
      repository,
    );

    expect(resolveOperation).toHaveBeenCalledWith(
      'repositories',
      'sync_evaluation_webhook',
      repository.projectId,
      'The GitHub evaluation webhook was synchronized successfully.',
    );
  });
});
