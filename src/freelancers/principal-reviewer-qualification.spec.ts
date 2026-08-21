import {
  defaultPrincipalReviewerRate,
  evaluatePrincipalReviewerQualification,
} from './principal-reviewer-qualification';

describe('principal reviewer qualification', () => {
  const profile = {
    verificationStatus: 'approved',
    yearsExperience: 9,
    assessmentScore: '91',
    performanceScore: '100',
    riskFlags: null,
    skills: ['System Design', 'Technical Leadership'],
  };

  it('accepts a senior approved freelancer with relevant evidence', () => {
    const result = evaluatePrincipalReviewerQualification(profile, [
      { skill: 'System Design', score: '4.2' },
      { skill: 'Security', score: '4.0' },
    ]);

    expect(result.eligibleToApply).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(result.requirements.qualifiedSkills).toHaveLength(2);
    expect(result.requirements.declaredRelevantSkills).toEqual([
      'System Design',
      'Technical Leadership',
    ]);
  });

  it('reports every unmet gate instead of silently matching', () => {
    const result = evaluatePrincipalReviewerQualification(
      {
        ...profile,
        verificationStatus: 'assessment_submitted',
        yearsExperience: 3,
        assessmentScore: '62',
        performanceScore: '70',
        riskFlags: [{ type: 'integrity' }],
        skills: [],
      },
      [],
    );

    expect(result.eligibleToApply).toBe(false);
    expect(result.gaps).toHaveLength(6);
  });

  it('calculates a reviewer-specific premium rounded to five', () => {
    expect(defaultPrincipalReviewerRate('410')).toBe(495);
    expect(defaultPrincipalReviewerRate('0')).toBeNull();
  });

  it('does not count differently formatted copies of one skill twice', () => {
    const result = evaluatePrincipalReviewerQualification(profile, [
      { skill: 'System Design', score: '4.2' },
      { skill: 'system-design', score: '4.8' },
    ]);

    expect(result.eligibleToApply).toBe(false);
    expect(result.requirements.qualifiedSkills).toEqual([
      { skill: 'system-design', score: 4.8 },
    ]);
  });
});
