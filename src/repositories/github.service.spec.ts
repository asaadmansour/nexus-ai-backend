import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';

describe('GithubService read-only inspection', () => {
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
    const service = new GithubService({
      get: jest.fn((key: string) => {
        if (key === 'GITHUB_TOKEN') return 'test-token';
        if (key === 'GITHUB_API_URL') return 'https://api.github.test';
        return undefined;
      }),
    } as unknown as ConfigService);

    try {
      const result = await service.inspectRepositorySnapshot({
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
});
