import type { Brief } from 'src/projects/entities/brief.entity';
import { buildPlanningEvaluationRequirements } from './planning-evaluation-requirements';

describe('buildPlanningEvaluationRequirements', () => {
  it('adds project feature coverage without duplicate requirement keys', () => {
    const brief = {
      coreFeatures: 'Real-time chat, Real time chat; Admin dashboard',
      deliverablesText: 'Admin dashboard\nMobile app',
    } as Brief;

    const requirements = buildPlanningEvaluationRequirements(
      'architecture',
      brief,
    );
    const keys = requirements.map((requirement) => requirement.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('feature_real_time_chat');
    expect(keys).toContain('feature_admin_dashboard');
    expect(keys).toContain('feature_mobile_app');
    expect(requirements.every((requirement) => requirement.mandatory)).toBe(
      true,
    );
  });

  it('requires URLs for implementation artifacts', () => {
    const requirements = buildPlanningEvaluationRequirements('ui_ux', null);
    const byKey = new Map(
      requirements.map((requirement) => [requirement.key, requirement]),
    );

    expect(byKey.get('figma_source')?.requiresUrl).toBe(true);
    expect(byKey.get('wireframes')?.requiresUrl).toBe(true);
    expect(byKey.get('clickable_prototype')?.requiresUrl).toBe(true);
    expect(byKey.get('screen_states')?.requiresUrl).toBe(false);
  });
});
