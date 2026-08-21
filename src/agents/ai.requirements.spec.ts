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
});
