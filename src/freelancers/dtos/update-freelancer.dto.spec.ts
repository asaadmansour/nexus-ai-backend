import { validateSync } from 'class-validator';
import { UpdateFreelancerDto } from './update-freelancer.dto';

describe('UpdateFreelancerDto', () => {
  const validateGithubUsername = (githubUsername: string) => {
    const dto = new UpdateFreelancerDto();
    dto.githubUsername = githubUsername;
    return validateSync(dto);
  };

  it.each(['octocat', 'nexus-ai', 'User123'])(
    'accepts the GitHub username %s',
    (githubUsername) => {
      expect(validateGithubUsername(githubUsername)).toHaveLength(0);
    },
  );

  it.each([
    '',
    '-octocat',
    'octocat-',
    'nexus--ai',
    'nexus_ai',
    'nexus ai',
    'a'.repeat(40),
  ])('rejects the GitHub username %s', (githubUsername) => {
    expect(validateGithubUsername(githubUsername)).not.toHaveLength(0);
  });
});
