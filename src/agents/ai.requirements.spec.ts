import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';

describe('AiService requirements guard', () => {
  const service = new AiService({
    get: (key: string) => (key === 'AI_MOCK_MODE' ? 'true' : undefined),
  } as ConfigService);

  it('redirects obvious trivia without invoking a requirements model', async () => {
    const result = await service.validateBrief({
      briefText: 'What is the capital of Egypt?',
    });

    expect(result.isComplete).toBe(false);
    expect(result.extractedFields).toEqual({});
    expect(result.suggestedReply).toContain('unrelated trivia');
    expect(result.extractionSource).toBe('scope_guard');
  });

  it('blocks malformed unrelated questions and resumes the actual pending field', async () => {
    const result = await service.validateBrief({
      briefText: 'what is capital Egypt',
      currentBrief: {
        pendingField: 'integrations',
        missingFields: ['integrations', 'adminNeeds'],
      },
    });

    expect(result.extractedFields).toEqual({});
    expect(result.suggestedReply).not.toContain('Cairo');
    expect(result.suggestedReply).toContain('outside services');
    expect(result.replyMode).toBe('scope_boundary');
  });

  it('blocks arbitrary non-project instructions, not only a trivia allowlist', async () => {
    const result = await service.validateBrief({
      briefText: 'Explain photosynthesis to me',
    });

    expect(result.extractionSource).toBe('scope_guard');
    expect(result.extractedFields).toEqual({});
    expect(result.suggestedReply).not.toContain('chlorophyll');
  });

  it('does not let a project keyword smuggle an unrelated knowledge request through', async () => {
    const result = await service.validateBrief({
      briefText: 'Explain photosynthesis for my website project',
    });

    expect(result.extractionSource).toBe('scope_guard');
    expect(result.extractedFields).toEqual({});
    expect(result.suggestedReply).not.toContain('chlorophyll');
  });

  it('does not perform general writing work inside requirements chat', async () => {
    const result = await service.validateBrief({
      briefText: 'Write a business email for me',
    });

    expect(result.extractionSource).toBe('scope_guard');
    expect(result.extractedFields).toEqual({});
  });

  it('uses the same nine customer-required fields as the production flow', async () => {
    const result = await service.validateBrief({
      briefText: 'That is all.',
      currentBrief: {
        knownFields: {
          mainGoal: 'Explain the business',
          targetUsers: ['customers'],
          coreFeatures: ['one responsive page'],
          platforms: ['website'],
          solutionType: 'landing page',
          scopeDetails: 'one page with five sections',
          integrations: 'none',
          adminNeeds: 'no admin dashboard',
          deliverables: ['source code', 'live link'],
        },
      },
    });

    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.completionPercentage).toBe(100);
  });

  it('guides an uncertain client instead of accepting idk', async () => {
    const result = await service.validateBrief({
      briefText: 'idk',
      currentBrief: {
        pendingField: 'scopeDetails',
        knownFields: {
          mainGoal: 'Display the business information',
          targetUsers: ['customers'],
          coreFeatures: ['Display service information'],
          platforms: ['website'],
          solutionType: 'landing page',
          integrations: 'none',
          adminNeeds: 'no admin dashboard',
          deliverables: ['working website'],
        },
      },
    });

    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('scopeDetails');
    expect(result.suggestedReply).toContain('page or screen count');
    expect(result.extractedFields?.scopeDetails).toBeUndefined();
  });

  it('does not use the customer budget minimum as the project price', async () => {
    const result = await service.estimateProjectQuote({
      project: {
        budgetMin: 275_000,
        budgetMax: 300_000,
        currency: 'EGP',
      },
      brief: {
        mainGoal: 'Present the business and collect customer enquiries',
        targetUsers: ['potential customers'],
        coreFeatures: ['Show service information', 'Contact enquiry form'],
        platforms: ['website'],
        solutionType: 'single landing page',
        scopeDetails: 'one page with five static sections',
        integrations: 'none',
        adminNeeds: 'no admin dashboard',
        deliverables: ['working website', 'source code', 'live link'],
        requirementProfile: { complexity: 'trivial' },
      },
    });

    expect(result.amount).toBe(result.recommendedMinimum);
    expect(result.amount).toBeLessThan(275_000);
  });
});
