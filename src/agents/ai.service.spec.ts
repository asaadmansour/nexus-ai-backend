import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

describe('AiService submission result normalization', () => {
  const service = new AiService(new ConfigService());

  it('fails closed when the provider claims a pass with an unmet rubric row', () => {
    const result = service.normalizeEvaluateSubmissionSandboxResult({
      passed: true,
      score: 95,
      revisionRequested: false,
      revisionNotes: '',
      requiresHumanReview: false,
      rubric: [
        {
          criterion: 'Tests pass',
          met: false,
          evidence: 'The test command failed.',
        },
      ],
      findings: [],
      risks: [],
    });

    expect(result.passed).toBe(false);
    expect(result.revisionRequested).toBe(true);
    expect(result.score).toBe(69);
  });

  it('fails closed when the provider returns no rubric', () => {
    const result = service.normalizeEvaluateSubmissionSandboxResult({
      passed: true,
      score: 100,
      revisionRequested: false,
      revisionNotes: '',
      requiresHumanReview: false,
      rubric: [],
      findings: [],
      risks: [],
    });

    expect(result.passed).toBe(false);
    expect(result.requiresHumanReview).toBe(true);
  });

  it('treats a normalized not-applicable row as satisfied', () => {
    const result = service.normalizeEvaluateSubmissionSandboxResult({
      passed: true,
      score: 88,
      revisionRequested: false,
      revisionNotes: '',
      requiresHumanReview: false,
      rubric: [
        {
          key: 'contract_compatibility',
          criterion: 'Touched contracts remain compatible',
          category: 'contract',
          status: 'not_applicable',
          met: false,
          evidence: 'The inspected static change does not touch any contract.',
        },
      ],
      findings: [],
      risks: [],
    });

    expect(result.passed).toBe(true);
    expect(result.rubric[0]).toMatchObject({
      status: 'not_applicable',
      met: true,
    });
  });
});
