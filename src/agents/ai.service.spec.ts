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

  it('routes evaluator visibility gaps to manual review without requesting code changes', () => {
    const result = service.normalizeEvaluateSubmissionSandboxResult({
      passed: false,
      score: 91,
      revisionRequested: true,
      revisionNotes: 'The source excerpt budget was exhausted.',
      requiresHumanReview: true,
      rubric: [
        {
          key: 'acceptance_1',
          criterion: 'The endpoint returns the documented response',
          category: 'requirement',
          status: 'met',
          met: true,
          evidence: 'The inspected tests demonstrate the response.',
        },
        {
          key: 'verification_observed_1',
          criterion: 'All changed files were inspectable',
          category: 'verification',
          status: 'unverified',
          met: false,
          evidence: 'The evaluator source excerpt budget was exhausted.',
        },
      ],
      findings: [],
      risks: [],
    });

    expect(result).toMatchObject({
      passed: true,
      score: 91,
      revisionRequested: false,
      requiresHumanReview: true,
    });
  });
});

describe('AiService fixed-package project quotes', () => {
  const service = new AiService(new ConfigService({ AI_MOCK_MODE: 'true' }));
  const brief = {
    mainGoal: 'Present the business and collect enquiries',
    targetUsers: ['potential customers'],
    coreFeatures: ['service information', 'contact form'],
    platforms: ['website'],
    solutionType: 'single landing page',
    scopeDetails: 'one page with five static sections',
    integrations: 'none',
    adminNeeds: 'no admin dashboard',
    deliverables: ['working website', 'source code'],
    requirementProfile: { complexity: 'trivial' },
  };

  it('prices a simple landing page as a small freelance package', async () => {
    const quote = await service.estimateProjectQuote({
      project: {
        budgetMin: 500,
        budgetMax: 50_000,
        currency: 'EGP',
      },
      brief,
    });

    expect(quote.amount).toBeGreaterThan(3_000);
    expect(quote.amount).toBeLessThan(15_000);
    expect(quote.rationale).toContain('Fixed-scope freelance package');
  });

  it('varies the package with confirmed scope instead of returning one hours-times-rate result', async () => {
    const landing = await service.estimateProjectQuote({
      project: { budgetMin: 500, budgetMax: 500_000, currency: 'EGP' },
      brief,
    });
    const application = await service.estimateProjectQuote({
      project: { budgetMin: 500, budgetMax: 500_000, currency: 'EGP' },
      brief: {
        ...brief,
        solutionType: 'custom web app',
        scopeDetails: '12 screens for customers and staff',
        coreFeatures: [
          'accounts',
          'catalog',
          'checkout',
          'orders',
          'reporting',
          'notifications',
        ],
        integrations: ['Stripe', 'email'],
        adminNeeds: 'admin dashboard for orders and users',
        requirementProfile: { complexity: 'standard' },
      },
    });

    expect(application.amount).toBeGreaterThan(landing.amount * 3);
  });

  it('does not let the customer budget inflate the same scope', async () => {
    const lowBudget = await service.estimateProjectQuote({
      project: { budgetMin: 500, budgetMax: 10_000, currency: 'EGP' },
      brief,
    });
    const highBudget = await service.estimateProjectQuote({
      project: { budgetMin: 275_000, budgetMax: 300_000, currency: 'EGP' },
      brief,
    });

    expect(highBudget.amount).toBe(lowBudget.amount);
  });
});
