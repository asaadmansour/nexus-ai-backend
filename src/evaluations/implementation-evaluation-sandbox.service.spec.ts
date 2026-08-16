import { ConfigService } from '@nestjs/config';
import { AiService } from 'src/agents/ai.service';
import { GithubService } from 'src/repositories/github.service';
import {
  ImplementationEvaluationSandboxService,
  parseGithubPullRequestUrl,
  parseGithubRepositoryUrl,
} from './implementation-evaluation-sandbox.service';

describe('Implementation evaluation sandbox', () => {
  function createService() {
    return new ImplementationEvaluationSandboxService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as AiService,
      {} as GithubService,
      {} as never,
      {} as never,
    );
  }

  it('strictly parses GitHub repository and pull-request URLs', () => {
    expect(
      parseGithubRepositoryUrl('https://github.com/Nexus/app.git'),
    ).toEqual({ owner: 'Nexus', repoName: 'app' });
    expect(
      parseGithubPullRequestUrl('https://github.com/Nexus/app/pull/42'),
    ).toEqual({ owner: 'Nexus', repoName: 'app', number: 42 });
    expect(parseGithubRepositoryUrl('https://evil.test/Nexus/app')).toBeNull();
    expect(
      parseGithubPullRequestUrl('https://github.com/Nexus/app/issues/42'),
    ).toBeNull();
  });

  it('separates GitHub and Gemini secrets from untrusted verification', () => {
    const service = createService() as unknown as {
      jobManifest: (
        namespace: string,
        name: string,
        image: string,
        input: string,
        target: {
          owner: string;
          repoName: string;
          commitSha: string;
          baseCommitSha: string | null;
          pullRequestNumber: number | null;
        },
      ) => {
        spec: {
          template: {
            spec: {
              automountServiceAccountToken: boolean;
              initContainers: Array<{
                name: string;
                env: Array<{ name: string }>;
                volumeMounts: Array<{
                  name: string;
                  readOnly?: boolean;
                }>;
              }>;
              containers: Array<{
                name: string;
                env: Array<{ name: string }>;
                volumeMounts: Array<{
                  name: string;
                  readOnly?: boolean;
                }>;
              }>;
            };
          };
        };
      };
    };
    const manifest = service.jobManifest(
      'default',
      'implementation-eval',
      'ai:sha',
      'payload',
      {
        owner: 'nexus',
        repoName: 'app',
        commitSha: 'a'.repeat(40),
        baseCommitSha: 'b'.repeat(40),
        pullRequestNumber: 4,
      },
    );
    const pod = manifest.spec.template.spec;
    const snapshot = pod.initContainers.find(
      (item) => item.name === 'snapshot',
    )!;
    const verifier = pod.initContainers.find((item) => item.name === 'verify')!;
    const evaluator = pod.containers[0];

    expect(pod.automountServiceAccountToken).toBe(false);
    expect(snapshot.env.map((item) => item.name)).toContain('GITHUB_TOKEN');
    expect(snapshot.env.map((item) => item.name)).not.toContain(
      'GEMINI_API_KEY',
    );
    expect(verifier.env.map((item) => item.name)).not.toContain('GITHUB_TOKEN');
    expect(verifier.env.map((item) => item.name)).not.toContain(
      'GEMINI_API_KEY',
    );
    expect(verifier.volumeMounts.map((item) => item.name)).not.toContain(
      'snapshot-evidence',
    );
    expect(snapshot.volumeMounts.map((item) => item.name)).not.toContain(
      'verification-evidence',
    );
    expect(evaluator.env.map((item) => item.name)).toContain('GEMINI_API_KEY');
    expect(evaluator.env.map((item) => item.name)).not.toContain(
      'GITHUB_TOKEN',
    );
    expect(
      evaluator.volumeMounts
        .filter((item) =>
          ['snapshot-evidence', 'verification-evidence'].includes(item.name),
        )
        .every((item) => item.readOnly === true),
    ).toBe(true);
  });
});
