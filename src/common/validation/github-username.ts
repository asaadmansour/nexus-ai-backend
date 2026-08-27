export const GITHUB_USERNAME_MAX_LENGTH = 39;

export const GITHUB_USERNAME_PATTERN =
  /^(?!.*--)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export const GITHUB_USERNAME_MESSAGE =
  'githubUsername may contain only letters, numbers, and single hyphens, with no leading or trailing hyphen';

export function normalizeGithubUsername(value: string) {
  return value.trim();
}
