import { ConflictException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

function removalHarness(options?: { accepted?: boolean }) {
  const project = {
    id: 'project-a',
    customerId: 'customer-a',
    status: 'brief_complete',
    principalReviewerAssignmentId: null,
  };
  const projectQuery: Record<string, jest.Mock> = {};
  for (const method of ['setLock', 'where']) {
    projectQuery[method] = jest.fn().mockReturnValue(projectQuery);
  }
  projectQuery.getOne = jest.fn().mockResolvedValue(project);
  const softDelete = jest.fn().mockResolvedValue({ affected: 1 });
  const manager = {
    getRepository: jest.fn().mockReturnValue({
      createQueryBuilder: jest.fn().mockReturnValue(projectQuery),
      softDelete,
    }),
    exists: jest.fn().mockResolvedValue(options?.accepted ?? false),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const service = Object.assign(Object.create(ProjectsService.prototype), {
    dataSource: {
      transaction: jest.fn(
        async (callback: (transactionManager: typeof manager) => unknown) =>
          callback(manager),
      ),
    },
  }) as ProjectsService;
  return { service, manager, projectQuery, softDelete };
}

describe('ProjectsService deletion policy', () => {
  it('rejects deletion after a principal reviewer or freelancer accepts', async () => {
    const { service, manager, softDelete } = removalHarness({
      accepted: true,
    });

    await expect(
      service.remove('project-a', 'customer-a', false),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('cancels pending work and notifications before soft deletion', async () => {
    const { service, manager, softDelete } = removalHarness();

    await expect(
      service.remove('project-a', 'customer-a', false),
    ).resolves.toBeUndefined();
    expect(manager.update).toHaveBeenCalledTimes(3);
    expect(manager.delete).toHaveBeenCalledTimes(1);
    expect(softDelete).toHaveBeenCalledWith('project-a');
  });
});
