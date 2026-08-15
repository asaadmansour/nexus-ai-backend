import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertTaskMatchingRunInvariant } from './matching.service';

describe('MatchingService task assignment invariants', () => {
  const task = { id: 'task-a', projectId: 'project-a' };

  it('rejects a candidate run from another task', () => {
    expect(() =>
      assertTaskMatchingRunInvariant(
        {
          id: 'run-b',
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
          id: 'run-a',
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
          id: 'run-a',
          targetType: 'task',
          targetTaskId: 'task-a',
          projectId: 'project-a',
          status: 'completed',
        },
        task,
      ),
    ).not.toThrow();
  });
});
