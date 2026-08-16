import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertPlanningApprovalPolicy,
  PlanningSubmissionsService,
} from './planning-submissions.service';

describe('planning submission approval policy', () => {
  const submission = (recommendation: string | null, status = 'completed') => ({
    evaluationStatus: status,
    evaluationRecommendation: recommendation,
  });

  it('allows a normal approval only after an approving evaluation', () => {
    expect(
      assertPlanningApprovalPolicy(submission('approve'), {
        status: 'approved',
      }),
    ).toBe(false);
    expect(() =>
      assertPlanningApprovalPolicy(submission('approve', 'running'), {
        status: 'approved',
      }),
    ).toThrow(ConflictException);
  });

  it('requires an explicit, meaningful reason to override the AI verdict', () => {
    expect(() =>
      assertPlanningApprovalPolicy(submission('changes_requested'), {
        status: 'approved',
      }),
    ).toThrow(ConflictException);
    expect(
      assertPlanningApprovalPolicy(submission('changes_requested'), {
        status: 'approved',
        aiOverride: true,
        aiOverrideReason:
          'Reviewed against the signed customer exception and accepted.',
      }),
    ).toBe(true);
  });

  it('rejects unnecessary or non-approval override data', () => {
    expect(() =>
      assertPlanningApprovalPolicy(submission('approve'), {
        status: 'approved',
        aiOverride: true,
        aiOverrideReason: 'This override should never be accepted by policy.',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPlanningApprovalPolicy(submission('changes_requested'), {
        status: 'changes_requested',
        aiOverride: true,
        aiOverrideReason: 'This is not an approval and cannot be overridden.',
      }),
    ).toThrow(BadRequestException);
  });

  it('does not expose sandbox logs outside the admin audit view', () => {
    const sanitizer = PlanningSubmissionsService.prototype as unknown as {
      publicAuditBundle: (
        bundle: Record<string, unknown>,
      ) => Record<string, unknown>;
    };
    expect(
      sanitizer.publicAuditBundle({
        verdictSha256: 'hash',
        sandboxLog: { excerpt: 'internal worker detail' },
      }),
    ).toEqual({ verdictSha256: 'hash' });
  });
});
