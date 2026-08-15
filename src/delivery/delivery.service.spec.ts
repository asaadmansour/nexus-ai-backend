import { ConflictException } from '@nestjs/common';
import {
  assertSubmissionMatchesCurrentTask,
  assertTaskAcceptsDraft,
} from './delivery.service';

describe('DeliveryService task/submission invariants', () => {
  it('rejects edits to work whose task is already in review or closed', () => {
    for (const status of ['review', 'done', 'cancelled']) {
      expect(() => assertTaskAcceptsDraft({ status })).toThrow(
        ConflictException,
      );
    }
  });

  it('rejects a stale draft after task reassignment', () => {
    expect(() =>
      assertSubmissionMatchesCurrentTask({
        taskId: 'task-a',
        freelancerProfileId: 'freelancer-a',
        task: { assignedFreelancerProfileId: 'freelancer-b' },
      }),
    ).toThrow(ConflictException);
  });

  it('accepts a submission owned by the current task assignee', () => {
    expect(() =>
      assertSubmissionMatchesCurrentTask({
        taskId: 'task-a',
        freelancerProfileId: 'freelancer-a',
        task: { assignedFreelancerProfileId: 'freelancer-a' },
      }),
    ).not.toThrow();
  });
});
