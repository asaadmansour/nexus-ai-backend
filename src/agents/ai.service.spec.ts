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

  it('does not turn detailed planning into a complex price package by itself', async () => {
    const quote = await service.estimateProjectQuote({
      project: {
        budgetMin: 500,
        budgetMax: 100_000,
        currency: 'EGP',
        deadline: '2027-10-10T00:00:00.000Z',
      },
      brief: {
        mainGoal: 'Manage appointment booking and a daily clinic queue',
        targetUsers: ['patients', 'reception staff', 'clinic managers'],
        coreFeatures: [
          'patients book appointments',
          'patients reschedule appointments',
          'reception staff manage daily queue',
          'clinic managers review appointment activity',
        ],
        platforms: ['website'],
        solutionType: 'web app',
        scopeDetails:
          'One-location booking, reception queue, and manager reporting workflows',
        integrations: ['none'],
        adminNeeds: 'no admin dashboard',
        deliverables: ['working website', 'source code', 'deployment help'],
        suggestedTeamSize: 2,
        requirementProfile: { complexity: 'complex' },
      },
    });

    expect(quote.amount).toBeGreaterThanOrEqual(35_000);
    expect(quote.amount).toBeLessThanOrEqual(40_000);
    expect(quote.pricingSignals).toContain(
      'Scope package: standard; estimated complexity: medium.',
    );
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

describe('AiService transient transport recovery', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries a transient provider failure with the same idempotency key', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('temporarily unavailable', { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ embedding: [0.1, 0.2], model: 'test' }), {
          status: 200,
        }),
      );
    const service = new AiService(
      new ConfigService({ AI_SERVICE_URL: 'https://ai.example' }),
    );

    const resultPromise = service.generateEmbedding({
      text: 'backend engineer',
      dimensions: 2,
    });
    await jest.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toMatchObject({ model: 'test' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<
      string,
      string
    >;
    expect(firstHeaders['Idempotency-Key']).toBeTruthy();
    expect(secondHeaders['Idempotency-Key']).toBe(
      firstHeaders['Idempotency-Key'],
    );
  });

  it('does not retry a validation response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('invalid payload', { status: 422 }));
    const service = new AiService(
      new ConfigService({ AI_SERVICE_URL: 'https://ai.example' }),
    );

    await expect(
      service.generateEmbedding({ text: 'backend engineer', dimensions: 2 }),
    ).rejects.toThrow('status 422');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
