import type { Brief } from 'src/projects/entities/brief.entity';
import {
  assessPlanningRequirementProfile,
  buildPlanningEvaluationRequirements,
  validatePlanningRequirementEvidence,
} from './planning-evaluation-requirements';

describe('adaptive planning evaluation requirements', () => {
  it('scales a hello-world architecture down to a bounded checklist', () => {
    const brief = {
      mainGoal: 'Display Hello World on one static page',
      coreFeatures: 'Display Hello World',
      platforms: 'website',
      deliverablesText: 'live link, source code',
    } as Brief;
    const project = {
      title: 'Hello World',
      description: 'A page that prints one string.',
    };

    const profile = assessPlanningRequirementProfile(project, brief);
    const requirements = buildPlanningEvaluationRequirements(
      'architecture',
      brief,
      project,
    );

    expect(profile.complexity).toBe('trivial');
    expect(requirements).toHaveLength(5);
    expect(requirements.map((item) => item.key)).toEqual([
      'system_context',
      'technology_stack',
      'non_functional',
      'deployment_observability',
      'project_feature_coverage',
    ]);
    expect(requirements.some((item) => item.key === 'api_contract')).toBe(
      false,
    );
    expect(
      requirements.some((item) => item.title.includes('live link coverage')),
    ).toBe(false);
  });

  it('rejects questions and deliverables as generated product features', () => {
    const brief = {
      mainGoal: 'Create a simple product page',
      coreFeatures: 'like what?, Product details, not sure, Source code',
      deliverablesText: 'live link\nMobile app',
      platforms: 'website',
    } as Brief;

    const profile = assessPlanningRequirementProfile(null, brief);
    const featureRequirement = buildPlanningEvaluationRequirements(
      'architecture',
      brief,
    ).find((item) => item.key === 'project_feature_coverage');

    expect(profile.features).toEqual(['Product details']);
    expect(featureRequirement?.description).toContain('Product details');
    expect(featureRequirement?.description).not.toContain('live link');
    expect(featureRequirement?.description).not.toContain('Mobile app');
  });

  it('adds contracts only for detected application capabilities', () => {
    const brief = {
      mainGoal: 'A marketplace with user accounts and Stripe checkout',
      coreFeatures:
        'Sign up, Product catalog, Checkout, Orders, Admin dashboard, Notifications, Seller profiles',
      platforms: 'website, mobile app',
    } as Brief;
    const requirements = buildPlanningEvaluationRequirements(
      'architecture',
      brief,
      { title: 'Marketplace' },
    );
    const keys = requirements.map((item) => item.key);

    expect(keys).toEqual(
      expect.arrayContaining([
        'api_contract',
        'data_model',
        'auth_security',
        'integrations',
      ]),
    );
    expect(
      assessPlanningRequirementProfile({ title: 'Marketplace' }, brief)
        .complexity,
    ).toBe('complex');
  });

  it('does not require Figma, flows, or a prototype for trivial UI work', () => {
    const brief = {
      mainGoal: 'Show Hello World on a static web page',
      coreFeatures: 'Display Hello World',
      platforms: 'website',
    } as Brief;
    const requirements = buildPlanningEvaluationRequirements('ui_ux', brief, {
      title: 'Hello World',
    });
    const keys = requirements.map((item) => item.key);

    expect(keys).toEqual([
      'screen_designs',
      'responsive_accessibility',
      'asset_handoff',
      'project_feature_coverage',
    ]);
    expect(keys).not.toContain('clickable_prototype');
    expect(keys).not.toContain('user_flows');
    expect(requirements[0].description).toContain('Figma is optional');
  });

  it('validates required evidence and justified N/A on the server', () => {
    const requirements = buildPlanningEvaluationRequirements(
      'architecture',
      {
        mainGoal: 'Internal dashboard with a backend API',
        coreFeatures: 'Dashboard, Reports, User accounts',
        platforms: 'website',
      } as Brief,
      { title: 'Reporting app' },
    );
    const content = {
      requirementEvidence: Object.fromEntries(
        requirements.map((item) => [
          item.key,
          item.allowNotApplicable
            ? {
                disposition: 'not_applicable',
                notApplicableReason:
                  'This concern is not used by the approved solution architecture.',
                summary: '',
                urls: [],
              }
            : {
                disposition: 'covered',
                summary: `Project-specific evidence for ${item.title}`,
                urls: item.requiresUrl ? ['https://example.com/artifact'] : [],
              },
        ]),
      ),
    };

    expect(validatePlanningRequirementEvidence(requirements, content)).toEqual(
      [],
    );
    const firstRequired = requirements.find(
      (item) => !item.allowNotApplicable,
    )!;
    (
      content.requirementEvidence[firstRequired.key] as Record<string, unknown>
    ).summary = '';
    expect(
      validatePlanningRequirementEvidence(requirements, content),
    ).toContain(`${firstRequired.title} needs project-specific evidence`);
  });
});
