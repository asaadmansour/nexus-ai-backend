import {
  getBriefScopeGaps,
  isRequirementsGuidanceRequest,
} from './brief-scope-readiness';

describe('brief scope readiness', () => {
  it('does not treat uncertainty as completed project scope', () => {
    expect(
      getBriefScopeGaps({
        mainGoal: 'idk',
        targetUsers: 'not sure',
        coreFeatures: 'whatever',
        platforms: 'you choose',
        solutionType: 'no idea',
        scopeDetails: 'tbd',
        integrations: 'not sure',
        adminNeeds: 'idk',
        deliverables: 'no preference',
      }),
    ).toEqual([
      'mainGoal',
      'targetUsers',
      'coreFeatures',
      'platforms',
      'solutionType',
      'scopeDetails',
      'integrations',
      'adminNeeds',
      'deliverables',
    ]);
  });

  it('rejects a mobile website label without a priceable product scope', () => {
    expect(
      getBriefScopeGaps({
        mainGoal: 'I want to make a mobile website',
        targetUsers: ['customers'],
        coreFeatures: ['mobile website'],
        platforms: ['website'],
        solutionType: 'responsive website',
        scopeDetails: 'a website',
        integrations: 'none',
        adminNeeds: 'no admin dashboard',
        deliverables: ['working website', 'source code'],
      }),
    ).toEqual(['mainGoal', 'coreFeatures', 'scopeDetails']);
  });

  it('accepts a concrete small landing-page scope', () => {
    expect(
      getBriefScopeGaps({
        mainGoal: 'Present the business and collect customer enquiries',
        targetUsers: ['potential customers'],
        coreFeatures: ['Show service information', 'Contact enquiry form'],
        platforms: ['website'],
        solutionType: 'single landing page',
        scopeDetails: 'one page with five static sections',
        integrations: 'none',
        adminNeeds: 'no admin dashboard',
        deliverables: ['working website', 'source code', 'live link'],
      }),
    ).toEqual([]);
  });

  it('recognizes questions and plain uncertainty as guidance requests', () => {
    expect(isRequirementsGuidanceRequest('idk')).toBe(true);
    expect(isRequirementsGuidanceRequest('What is an admin dashboard?')).toBe(
      true,
    );
    expect(isRequirementsGuidanceRequest('Customers place orders')).toBe(false);
  });
});
