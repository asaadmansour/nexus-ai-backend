import {
  formatProfessionalTitle,
  inferAssessmentTargetSeniority,
  inferProfessionalRole,
  seniorityFromAssessmentScore,
} from './professional-classification';

describe('professional classification', () => {
  it('infers a supported role from CV evidence', () => {
    expect(
      inferProfessionalRole({
        headline: 'Software Engineer',
        skills: ['NestJS', 'PostgreSQL'],
      }),
    ).toBe('backend');
    expect(
      inferProfessionalRole({
        headline: 'Product Designer',
        skills: ['Figma', 'User research'],
      }),
    ).toBe('ui_ux');
  });

  it('uses CV seniority only as the assigned assessment level', () => {
    expect(
      inferAssessmentTargetSeniority({
        headline: 'Senior Backend Engineer',
        yearsExperience: 7,
      }),
    ).toBe('senior');
    expect(inferAssessmentTargetSeniority({ yearsExperience: 4 })).toBe('mid');
  });

  it('derives the stored rank from the assessment score', () => {
    expect(seniorityFromAssessmentScore(59.99)).toBe('junior');
    expect(seniorityFromAssessmentScore(60)).toBe('mid');
    expect(seniorityFromAssessmentScore(80)).toBe('senior');
    expect(formatProfessionalTitle('backend', 'junior')).toBe('Junior Backend');
  });
});
