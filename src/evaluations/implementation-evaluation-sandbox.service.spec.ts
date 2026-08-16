import { ConfigService } from '@nestjs/config';
import { AiService } from 'src/agents/ai.service';
import { GithubService } from 'src/repositories/github.service';
import {
  ImplementationEvaluationSandboxService,
  parseGithubPullRequestUrl,
  parseGithubRepositoryUrl,
} from './implementation-evaluation-sandbox.service';
import type { EvaluateSubmissionResult } from 'src/agents/ai.service';

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
          pullRequestUrl: string | null;
          pullRequestState: string | null;
          pullRequestDraft: boolean;
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
        pullRequestUrl: 'https://github.com/nexus/app/pull/4',
        pullRequestState: 'open',
        pullRequestDraft: false,
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

  it('adds read-only GitHub inspection before HTTP evaluation', async () => {
    const commitSha = 'a'.repeat(40);
    const baseSha = 'b'.repeat(40);
    const inspection = {
      sourceInspected: true,
      snapshotVerified: true,
      verificationComplete: true,
      sourceExcerpts: [{ path: 'index.html', content: '1: <h1>Hello</h1>' }],
    };
    const evaluateSubmission: jest.MockedFunction<
      AiService['evaluateSubmission']
    > = jest.fn().mockResolvedValue({
      passed: true,
      score: 100,
      revisionRequested: false,
      revisionNotes: '',
      requiresHumanReview: false,
      rubric: [],
      findings: [],
      risks: [],
      source: 'fastapi',
    } satisfies EvaluateSubmissionResult);
    const query = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const github = {
      getPullRequest: jest.fn().mockResolvedValue({
        number: 1,
        headSha: commitSha,
        baseSha,
        url: 'https://github.com/muhanadmedhat/project-hello-world/pull/1',
        state: 'open',
        draft: false,
      }),
      inspectRepositorySnapshot: jest.fn().mockResolvedValue({
        inspection,
        audit: { executionMode: 'http-readonly' },
      }),
    };
    const service = new ImplementationEvaluationSandboxService(
      {
        get: jest.fn((key: string) =>
          key === 'EVALUATION_SANDBOX_MODE' ? 'http' : undefined,
        ),
      } as unknown as ConfigService,
      { evaluateSubmission } as unknown as AiService,
      github as unknown as GithubService,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'repository-id',
          projectId: 'project-id',
          provider: 'github',
          owner: 'muhanadmedhat',
          repoName: 'project-hello-world',
        }),
      } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(query) } as never,
    );

    const result = await service.evaluate(
      {
        project: { projectId: 'project-id' },
        task: {
          taskId: 'task-id',
          title: 'Hello World',
          isSpecTask: false,
        },
        submission: {
          submissionId: 'submission-id',
          submissionType: 'pull_request',
          repositoryUrl: 'https://github.com/muhanadmedhat/project-hello-world',
          pullRequestUrl:
            'https://github.com/muhanadmedhat/project-hello-world/pull/1',
          commitSha,
        },
      },
      'agent-job-id',
    );

    expect(evaluateSubmission).toHaveBeenCalledTimes(1);
    expect(evaluateSubmission.mock.calls[0][0].submission.inspection).toEqual(
      inspection,
    );
    expect(result.auditBundle.executionMode).toBe('http-readonly');
    expect(result.evaluatedCommitSha).toBe(commitSha);
  });
});
