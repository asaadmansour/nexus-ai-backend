import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertTaskMatchingRunInvariant,
  MatchingService,
} from './matching.service';

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

  it('recovers existing projects whose reviewer accepted before planning-role matching started', async () => {
    const autoStartPlanningRoles = jest.fn().mockResolvedValue(undefined);
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
});
