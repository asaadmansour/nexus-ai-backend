export const PRINCIPAL_REVIEWER_ROLE = 'principal_reviewer';
export const PRINCIPAL_REVIEWER_MIN_EXPERIENCE_YEARS = 7;
export const PRINCIPAL_REVIEWER_MIN_ASSESSMENT_SCORE = 80;
export const PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE = 80;
export const PRINCIPAL_REVIEWER_MIN_SKILL_SCORE = 3.5;
export const PRINCIPAL_REVIEWER_MIN_QUALIFIED_SKILLS = 2;
export const PRINCIPAL_REVIEWER_MAX_PROJECTS = 3;

export const PRINCIPAL_REVIEWER_SKILLS = [
  'Solution Architecture',
  'System Design',
  'Technical Leadership',
  'Code Review',
  'Risk Management',
  'Project Planning',
  'API Design',
  'Security',
] as const;

export type PrincipalReviewerStatus =
  'not_applied' | 'pending' | 'approved' | 'rejected' | 'suspended';

interface QualificationProfile {
  verificationStatus: string;
  yearsExperience: number | null;
  assessmentScore: string | number | null;
  performanceScore: string | number;
  riskFlags: Record<string, unknown>[] | null;
  skills: string[] | null;
}

interface QualificationSkillScore {
  skill: string;
  score: string | number;
}

export interface PrincipalReviewerQualification {
  eligibleToApply: boolean;
  requirements: {
    baseProfileApproved: boolean;
    minimumExperienceYears: number;
    yearsExperience: number;
    minimumAssessmentScore: number;
    assessmentScore: number;
    minimumPerformanceScore: number;
    performanceScore: number;
    minimumQualifiedSkills: number;
    minimumSkillScore: number;
    qualifiedSkills: Array<{ skill: string; score: number | null }>;
    declaredRelevantSkills: string[];
    noRiskFlags: boolean;
  };
  gaps: string[];
}

function normaliseSkill(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

export function isPrincipalReviewerSkill(skill: string) {
  const candidate = normaliseSkill(skill);
  return PRINCIPAL_REVIEWER_SKILLS.some((required) => {
    const expected = normaliseSkill(required);
    return candidate.includes(expected) || expected.includes(candidate);
  });
}

export function evaluatePrincipalReviewerQualification(
  profile: QualificationProfile,
  skillScores: QualificationSkillScore[],
): PrincipalReviewerQualification {
  const yearsExperience = Math.max(0, profile.yearsExperience ?? 0);
  const assessmentScore = Math.max(0, Number(profile.assessmentScore ?? 0));
  const performanceScore = Math.max(0, Number(profile.performanceScore ?? 0));
  const scoredBySkill = new Map<
    string,
    { skill: string; score: number | null }
  >();
  for (const entry of skillScores) {
    const score = Number(entry.score);
    if (
      !isPrincipalReviewerSkill(entry.skill) ||
      !Number.isFinite(score) ||
      score < PRINCIPAL_REVIEWER_MIN_SKILL_SCORE
    ) {
      continue;
    }
    const key = normaliseSkill(entry.skill);
    const existing = scoredBySkill.get(key);
    if (!existing || score > (existing.score ?? 0)) {
      scoredBySkill.set(key, { skill: entry.skill, score });
    }
  }
  const qualifiedSkills = [...scoredBySkill.values()].sort((left, right) =>
    left.skill.localeCompare(right.skill),
  );
  const declaredRelevantSkills = [
    ...new Map(
      (profile.skills ?? [])
        .filter(isPrincipalReviewerSkill)
        .map((skill) => [normaliseSkill(skill), skill]),
    ).values(),
  ].sort((left, right) => left.localeCompare(right));
  const baseProfileApproved = profile.verificationStatus === 'approved';
  const noRiskFlags = (profile.riskFlags?.length ?? 0) === 0;
  const gaps: string[] = [];

  if (!baseProfileApproved) {
    gaps.push('Complete and pass the standard freelancer verification first.');
  }
  if (yearsExperience < PRINCIPAL_REVIEWER_MIN_EXPERIENCE_YEARS) {
    gaps.push(
      `At least ${PRINCIPAL_REVIEWER_MIN_EXPERIENCE_YEARS} years of relevant experience is required.`,
    );
  }
  if (assessmentScore < PRINCIPAL_REVIEWER_MIN_ASSESSMENT_SCORE) {
    gaps.push(
      `An assessment score of at least ${PRINCIPAL_REVIEWER_MIN_ASSESSMENT_SCORE}% is required.`,
    );
  }
  if (performanceScore < PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE) {
    gaps.push(
      `A performance score of at least ${PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE}% is required.`,
    );
  }
  if (qualifiedSkills.length < PRINCIPAL_REVIEWER_MIN_QUALIFIED_SKILLS) {
    gaps.push(
      `Add evidence for at least ${PRINCIPAL_REVIEWER_MIN_QUALIFIED_SKILLS} principal-reviewer skills.`,
    );
  }
  if (!noRiskFlags) {
    gaps.push('Resolve active performance or integrity risk flags.');
  }

  return {
    eligibleToApply: gaps.length === 0,
    requirements: {
      baseProfileApproved,
      minimumExperienceYears: PRINCIPAL_REVIEWER_MIN_EXPERIENCE_YEARS,
      yearsExperience,
      minimumAssessmentScore: PRINCIPAL_REVIEWER_MIN_ASSESSMENT_SCORE,
      assessmentScore,
      minimumPerformanceScore: PRINCIPAL_REVIEWER_MIN_PERFORMANCE_SCORE,
      performanceScore,
      minimumQualifiedSkills: PRINCIPAL_REVIEWER_MIN_QUALIFIED_SKILLS,
      minimumSkillScore: PRINCIPAL_REVIEWER_MIN_SKILL_SCORE,
      qualifiedSkills,
      declaredRelevantSkills,
      noRiskFlags,
    },
    gaps,
  };
}

export function defaultPrincipalReviewerRate(baseHourlyRate: string | number) {
  const rate = Number(baseHourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.ceil((rate * 1.2) / 5) * 5;
}
