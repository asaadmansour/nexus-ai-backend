import { FreelancerProfile } from './entities/freelancer-profile.entity';

/**
 * Conditions a profile must meet before matching will ever consider it.
 *
 * Matching filters on these in SQL; approval must apply the same rules, or the
 * platform approves freelancers it can never staff. Five of seven seeded
 * freelancers were approved with no GitHub username and were therefore
 * permanently unmatchable, with the failure reported as a skills/rate problem.
 * See ISSUES.md #21.
 *
 * Keep this list and `buildProfileQuery()` in matching.service.ts in step.
 */
export function missingMatchingPrerequisites(
  profile: Pick<FreelancerProfile, 'githubUsername'>,
): string[] {
  const missing: string[] = [];
  if (!profile.githubUsername || !profile.githubUsername.trim()) {
    missing.push('a GitHub username');
  }
  return missing;
}

export function describeMissingPrerequisites(missing: string[]): string {
  return missing.length === 1
    ? missing[0]
    : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
}
