import { FreelancerProfile } from './entities/freelancer-profile.entity';

export function calculateAssessedHourlyRate(
  profile: Pick<
    FreelancerProfile,
    'assessmentScore' | 'yearsExperience' | 'interviewScore'
  >,
  skillScores: Array<{ score: string | number }>,
) {
  const averageSkill = skillScores.length
    ? skillScores.reduce((sum, item) => sum + Number(item.score), 0) /
      skillScores.length
    : 2.5;
  const assessment = Math.max(
    0,
    Math.min(Number(profile.assessmentScore ?? 50), 100),
  );
  const experience = Math.max(
    0,
    Math.min(Number(profile.yearsExperience ?? 0), 15),
  );
  const interview = Math.max(
    0,
    Math.min(Number(profile.interviewScore ?? assessment), 100),
  );
  const qualityFactor =
    (assessment / 100) * 0.4 +
    (averageSkill / 5) * 0.25 +
    (experience / 15) * 0.2 +
    (interview / 100) * 0.15;
  const minimum = Number(process.env.FREELANCER_MIN_HOURLY_RATE ?? 150);
  const maximum = Number(process.env.FREELANCER_MAX_HOURLY_RATE ?? 1200);
  const safeMinimum = Number.isFinite(minimum) && minimum > 0 ? minimum : 150;
  const safeMaximum =
    Number.isFinite(maximum) && maximum > safeMinimum ? maximum : 1200;
  return (
    Math.round(
      (safeMinimum + (safeMaximum - safeMinimum) * qualityFactor) / 5,
    ) * 5
  );
}
