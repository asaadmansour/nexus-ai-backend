import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';

describe('GithubService read-only inspection', () => {
  const service = () =>
    new GithubService({
      get: jest.fn((key: string) => {
        if (key === 'GITHUB_TOKEN') return 'test-token';
        if (key === 'GITHUB_API_URL') return 'https://api.github.test';
        return undefined;
      }),
    } as unknown as ConfigService);

  it('excludes generated artifacts and lockfiles from source-inspection coverage', () => {
    const github = service();
    const isGenerated = Reflect.get(github, 'isGeneratedInspectionPath') as (
      path: string,
    ) => boolean;

    expect(isGenerated.call(github, 'package-lock.json')).toBe(true);
    expect(isGenerated.call(github, 'frontend/.next/server/app.js')).toBe(true);
    expect(isGenerated.call(github, 'src/__snapshots__/view.snap')).toBe(true);
    expect(isGenerated.call(github, 'src/orders/orders.service.ts')).toBe(
      false,
    );
  });

  it('builds complete source and static verification evidence for a tiny PR', async () => {
    const commitSha = 'a'.repeat(40);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes('/git/trees/')) {
          return Promise.resolve(
            Response.json({
              truncated: false,
              tree: [
                {
                  path: 'index.html',
                  type: 'blob',
                  size: 52,
                  sha: 'blob-sha',
                },
              ],
            }),
          );
        }
        if (url.includes('/pulls/1/files')) {
          return Promise.resolve(
            Response.json([
              {
                filename: 'index.html',
                status: 'added',
                additions: 1,
                deletions: 0,
                changes: 1,
                patch: '+<h1>Hello, world!</h1>',
              },
            ]),
          );
        }
        if (url.includes('/check-runs')) {
          return Promise.resolve(
            Response.json({ total_count: 0, check_runs: [] }),
          );
        }
        if (url.endsWith('/status')) {
          return Promise.resolve(
            Response.json({ state: 'pending', statuses: [] }),
          );
        }
        if (url.includes('/contents/index.html')) {
          return Promise.resolve(
            Response.json({
              type: 'file',
              encoding: 'base64',
              path: 'index.html',
              sha: 'blob-sha',
              content: Buffer.from(
                '<!doctype html><style>:root{--ink:#111}</style><h1>Hello, world!</h1>',
              ).toString('base64'),
            }),
          );
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      });
    const github = service();

    try {
      const result = await github.inspectRepositorySnapshot({
        owner: 'muhanadmedhat',
        repoName: 'project-hello-world',
        commitSha,
        baseCommitSha: 'b'.repeat(40),
        pullRequestNumber: 1,
        pullRequestUrl:
          'https://github.com/muhanadmedhat/project-hello-world/pull/1',
        pullRequestState: 'open',
        pullRequestDraft: false,
      });

      expect(result.inspection).toMatchObject({
        sourceInspected: true,
        snapshotVerified: true,
        verificationComplete: true,
        complete: true,
        pullRequest: {
          number: 1,
          state: 'open',
          draft: false,
          headSha: commitSha,
        },
        coverage: { changedFileCoverage: 1 },
      });
      const sourceExcerpts = result.inspection.sourceExcerpts;
      expect(Array.isArray(sourceExcerpts)).toBe(true);
      const firstExcerpt = (
        sourceExcerpts as Array<Record<string, unknown>>
      )[0];
      expect(firstExcerpt.path).toBe('index.html');
      expect(String(firstExcerpt.content)).toContain('<h1>Hello, world!</h1>');
      expect(result.audit.executionMode).toBe('http-readonly');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('treats a concurrently completed merge as successful', async () => {
    const headSha = 'a'.repeat(40);
    const baseSha = 'b'.repeat(40);
    let pullReads = 0;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith('/pulls/4') && init?.method === 'GET') {
          pullReads += 1;
          return Promise.resolve(
            Response.json({
              number: 4,
              state: pullReads === 1 ? 'open' : 'closed',
              draft: false,
              merged: pullReads > 1,
              merge_commit_sha: pullReads > 1 ? 'c'.repeat(40) : null,
              head: { sha: headSha, ref: 'feature' },
              base: { sha: baseSha, ref: 'main' },
            }),
          );
        }
        if (url.endsWith('/pulls/4/merge') && init?.method === 'PUT') {
          return Promise.resolve(
            Response.json(
              { merged: false, message: 'Base branch was modified' },
              { status: 409 },
            ),
          );
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      });

    try {
      await expect(
        service().mergePullRequest({
          owner: 'nexus-ai',
          repoName: 'project',
          number: 4,
          expectedHeadSha: headSha,
        }),
      ).resolves.toEqual({
        merged: true,
        sha: 'c'.repeat(40),
        message: 'Pull request was merged by a concurrent integration run',
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('recovers an already-created deterministic repository', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        id: 42,
        html_url: 'https://github.com/nexus-ai/project-a',
        default_branch: 'main',
      }),
    );

    try {
      await expect(
        service().findRepository({ owner: 'nexus-ai', repoName: 'project-a' }),
      ).resolves.toEqual({
        externalId: '42',
        repoUrl: 'https://github.com/nexus-ai/project-a',
        defaultBranch: 'main',
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('returns null when the deterministic repository does not exist', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('not found', { status: 404 }));

    try {
      await expect(
        service().findRepository({ owner: 'nexus-ai', repoName: 'missing' }),
      ).resolves.toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
