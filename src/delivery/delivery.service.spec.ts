import { ConflictException } from '@nestjs/common';
import {
  assertSubmissionApprovalEvaluation,
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

  it('blocks approval before evaluation completes or after requested changes', () => {
    const submission = {
      submissionType: 'pull_request',
      commitSha: 'a'.repeat(40),
    };
    expect(() =>
      assertSubmissionApprovalEvaluation(submission, null, {}),
    ).toThrow('until the latest evaluation completes');
    expect(() =>
      assertSubmissionApprovalEvaluation(
        submission,
        {
          id: 'run',
          status: 'completed',
          recommendation: 'changes_requested',
          evaluatedCommitSha: 'a'.repeat(40),
        },
        {},
      ),
    ).toThrow('requested changes');
  });

  it('blocks approval when the evaluated commit is stale', () => {
    expect(() =>
      assertSubmissionApprovalEvaluation(
        {
          submissionType: 'repository',
          commitSha: 'a'.repeat(40),
        },
        {
          id: 'run',
          status: 'completed',
          recommendation: 'approve',
          evaluatedCommitSha: 'b'.repeat(40),
        },
        {},
      ),
    ).toThrow('does not match the current submitted commit');
  });

  it('requires explicit evidence acknowledgement for a manual review', () => {
    const submission = {
      submissionType: 'pull_request',
      commitSha: 'a'.repeat(40),
    };
    const evaluation = {
      id: 'run',
      status: 'completed',
      recommendation: 'manual_review',
      evaluatedCommitSha: 'a'.repeat(40),
    };
    expect(() =>
      assertSubmissionApprovalEvaluation(submission, evaluation, {
        manualReviewAcknowledged: true,
        feedback: 'too short',
      }),
    ).toThrow('at least 20 characters');
    expect(() =>
      assertSubmissionApprovalEvaluation(submission, evaluation, {
        manualReviewAcknowledged: true,
        feedback: 'I inspected the exact diff and verification evidence.',
      }),
    ).not.toThrow();
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
