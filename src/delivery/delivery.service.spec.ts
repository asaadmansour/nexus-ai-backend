import { ConflictException } from '@nestjs/common';
import {
  assertSubmissionApprovalEvaluation,
  assertSubmissionCanBeReviewed,
  hasOnlyEvaluatorVisibilityGaps,
  assertSubmissionMatchesCurrentTask,
  assertImplementationWorkFunded,
  assertDependencyIntegratedForSubmission,
  assertTaskAcceptsDraft,
  isSubmissionIntegrationRecovery,
  isActiveSubmissionVersion,
  isSuccessfulSubmissionIntegration,
  resolveSubmissionReviewCriteria,
  submissionNeedsEvaluationDispatch,
  validateSubmissionCriterionReviews,
} from './delivery.service';

describe('DeliveryService task/submission invariants', () => {
  it('releases task escrow only after successful repository integration', () => {
    expect(
      isSuccessfulSubmissionIntegration({
        integration: { status: 'merged' },
      }),
    ).toBe(true);
    expect(
      isSuccessfulSubmissionIntegration({
        integration: { status: 'default_branch_verified' },
      }),
    ).toBe(true);
    expect(
      isSuccessfulSubmissionIntegration({
        integration: { status: 'failed' },
      }),
    ).toBe(false);
  });

  it('ignores superseded submission versions in pull-request history checks', () => {
    expect(isActiveSubmissionVersion({ status: 'superseded' })).toBe(false);
    expect(isActiveSubmissionVersion({ status: 'under_review' })).toBe(true);
    expect(isActiveSubmissionVersion({ status: 'approved' })).toBe(true);
  });

  it('recovers an idempotent submission whose evaluation was not dispatched', () => {
    expect(
      submissionNeedsEvaluationDispatch(
        { status: 'submitted', metadata: null },
        true,
      ),
    ).toBe(true);
    expect(
      submissionNeedsEvaluationDispatch(
        {
          status: 'submitted',
          metadata: { evaluationDispatch: { status: 'failed' } },
        },
        true,
      ),
    ).toBe(true);
    expect(
      submissionNeedsEvaluationDispatch(
        {
          status: 'under_review',
          metadata: { evaluationDispatch: { status: 'queued' } },
        },
        true,
      ),
    ).toBe(false);
  });

  it('requires blocking dependencies to be approved and integrated into main', () => {
    expect(() =>
      assertDependencyIntegratedForSubmission(
        { status: 'done' },
        {
          status: 'approved',
          metadata: { integration: { status: 'failed' } },
        },
      ),
    ).toThrow('has not been integrated');
    expect(() =>
      assertDependencyIntegratedForSubmission(
        { status: 'done' },
        {
          status: 'approved',
          metadata: { integration: { status: 'merged' } },
        },
      ),
    ).not.toThrow();
  });

  it('recognizes a reopened integration without replaying first approval effects', () => {
    expect(
      isSubmissionIntegrationRecovery({
        metadata: {
          integrationRecovery: { status: 'evaluation_pending' },
        },
      }),
    ).toBe(true);
    expect(
      isSubmissionIntegrationRecovery({
        metadata: {
          integrationRecovery: { status: 'reapproved' },
        },
      }),
    ).toBe(false);
  });

  it('keeps reserved implementation work locked until the second escrow stage activates it', () => {
    expect(() =>
      assertImplementationWorkFunded({
        assignmentStatus: 'reserved',
        assignedAt: null,
      }),
    ).toThrow('implementation escrow is not funded');
    expect(() =>
      assertImplementationWorkFunded({
        assignmentStatus: 'accepted',
        assignedAt: new Date(),
      }),
    ).not.toThrow();
  });

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

  it('keeps automated changes-requested submissions reviewable but preserves human revisions', () => {
    expect(() =>
      assertSubmissionCanBeReviewed({
        status: 'changes_requested',
        reviewedBy: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertSubmissionCanBeReviewed({
        status: 'changes_requested',
        reviewedBy: 'reviewer-1',
      }),
    ).toThrow('automatically bounced');
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

  it('allows only an explicit principal-reviewer override of requested changes', () => {
    const submission = {
      submissionType: 'pull_request',
      commitSha: 'a'.repeat(40),
    };
    const evaluation = {
      id: 'run',
      status: 'completed',
      recommendation: 'changes_requested',
      evaluatedCommitSha: 'a'.repeat(40),
    };

    expect(() =>
      assertSubmissionApprovalEvaluation(
        submission,
        evaluation,
        {
          manualReviewAcknowledged: true,
          feedback: 'I verified the extra scope is required for this task.',
        },
        { allowChangesRequestedOverride: true },
      ),
    ).not.toThrow();
  });

  it('allows a reviewer to resolve a legacy observability-only bounce', () => {
    const evaluation = {
      id: 'run',
      status: 'completed',
      recommendation: 'changes_requested',
      evaluatedCommitSha: 'a'.repeat(40),
      acceptanceCoverage: {
        items: [
          {
            key: 'acceptance_1',
            status: 'met',
            met: true,
          },
          {
            key: 'verification_observed_1',
            status: 'unmet',
            met: false,
          },
        ],
      },
    };

    expect(hasOnlyEvaluatorVisibilityGaps(evaluation as never)).toBe(true);
    expect(() =>
      assertSubmissionApprovalEvaluation(
        {
          submissionType: 'pull_request',
          commitSha: 'a'.repeat(40),
        },
        evaluation as never,
        {
          manualReviewAcknowledged: true,
          feedback: 'I inspected the exact pull request and verified the work.',
        },
      ),
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

  it('requires a 1-to-5 review for every applicable evaluation criterion', () => {
    const evaluation = {
      acceptanceCoverage: {
        items: [
          {
            key: 'acceptance_1',
            criterion: 'The endpoint works',
            status: 'met',
          },
          {
            key: 'operations',
            criterion: 'Deployment notes are supplied',
            status: 'not_applicable',
          },
          { key: 'quality', criterion: 'The code is clear', status: 'met' },
        ],
      },
    };
    expect(resolveSubmissionReviewCriteria(evaluation)).toHaveLength(2);
    expect(
      resolveSubmissionReviewCriteria({
        acceptanceCoverage: {
          items: [],
          rubricSnapshot: {
            criteria: [
              {
                key: 'queued_acceptance',
                criterion: 'The queued rubric remains reviewable',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        criterionKey: 'queued_acceptance',
        criterion: 'The queued rubric remains reviewable',
      },
    ]);
    expect(() =>
      validateSubmissionCriterionReviews(evaluation, [
        {
          criterionKey: 'acceptance_1',
          rating: 5,
        },
      ]),
    ).toThrow('Rate every applicable review criterion');

    expect(
      validateSubmissionCriterionReviews(evaluation, [
        {
          criterionKey: 'acceptance_1',
          rating: 5,
        },
        {
          criterionKey: 'quality',
          rating: 4,
          comment: 'Small naming issue',
        },
      ]),
    ).toEqual({
      reviews: [
        {
          criterionKey: 'acceptance_1',
          criterion: 'The endpoint works',
          rating: 5,
          comment: null,
        },
        {
          criterionKey: 'quality',
          criterion: 'The code is clear',
          rating: 4,
          comment: 'Small naming issue',
        },
      ],
      score: 90,
    });

    expect(() =>
      validateSubmissionCriterionReviews(evaluation, [
        { criterionKey: 'acceptance_1', rating: 5 },
        { criterionKey: 'acceptance_1', rating: 4 },
      ]),
    ).toThrow('may be rated only once');
    expect(() =>
      validateSubmissionCriterionReviews(evaluation, [
        { criterionKey: 'acceptance_1', rating: 5 },
        { criterionKey: 'outdated_key', rating: 4 },
      ]),
    ).toThrow('Rate every applicable review criterion');
  });
});
