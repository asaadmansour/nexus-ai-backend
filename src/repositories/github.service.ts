import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export type GithubRepoResult = {
  externalId: string | null;
  repoUrl: string;
  defaultBranch: string;
};

export type GithubInviteResult = {
  // GitHub returns an invitation for a new collaborator, or 204 when the user
  // is already a collaborator on the repo.
  alreadyCollaborator: boolean;
  inviteUrl: string | null;
  githubUserId: string | null;
};

type GithubRepoResponse = {
  id?: number;
  html_url?: string;
  default_branch?: string;
};

type GithubInviteResponse = {
  html_url?: string;
  invitee?: { id?: number };
};

type GithubCommitResponse = {
  sha?: string;
  html_url?: string;
};

type GithubPullRequestResponse = {
  number?: number;
  html_url?: string;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  merge_commit_sha?: string | null;
  head?: { sha?: string; ref?: string };
  base?: { sha?: string; ref?: string };
};

type GithubMergePullRequestResponse = {
  sha?: string | null;
  merged?: boolean;
  message?: string;
};

type GithubUpdatePullRequestBranchResponse = {
  message?: string;
  url?: string;
};

type GithubPullFileResponse = {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
};

type GithubTreeResponse = {
  truncated?: boolean;
  tree?: Array<{
    path?: string;
    type?: string;
    size?: number;
    sha?: string;
  }>;
};

type GithubContentResponse = {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
  sha?: string;
  path?: string;
};

type GithubChecksResponse = {
  total_count?: number;
  check_runs?: Array<{
    name?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
  }>;
};

type GithubCombinedStatusResponse = {
  state?: string;
  statuses?: Array<{
    context?: string;
    state?: string;
    description?: string;
    target_url?: string;
  }>;
};

type GithubCompareResponse = {
  status?: string;
};

export type GithubReadOnlyInspection = {
  inspection: Record<string, unknown>;
  audit: Record<string, unknown>;
};

export type GithubCommitTarget = {
  sha: string;
  url: string | null;
};

export type GithubRepositoryArchive = {
  buffer: Buffer;
  contentType: string;
  sha256: string;
};

export type GithubPullRequestTarget = {
  number: number;
  url: string | null;
  state: string | null;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  mergeCommitSha: string | null;
  headSha: string;
  headRef: string | null;
  baseSha: string;
  baseRef: string | null;
};

export type GithubPullRequestBranchSyncResult = {
  status: 'current' | 'update_requested' | 'conflict';
  message: string | null;
  headSha: string;
  baseSha: string;
};

export type GithubMergePullRequestResult = {
  merged: boolean;
  sha: string | null;
  message: string | null;
};

export type GithubWebhookResult = {
  id: string | null;
  url: string;
  active: boolean;
};

type GithubWebhookResponse = {
  id?: number;
  active?: boolean;
  config?: { url?: string };
};

/**
 * Thin GitHub REST client for the Nexus-owned implementation repositories.
 * It never mocks: if GitHub is not configured or a call fails, it throws and the
 * caller stores a failed/retryable status.
 */
@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(private readonly config: ConfigService) {}

  get owner(): string | null {
    return this.config.get<string>('GITHUB_OWNER') ?? null;
  }

  get defaultVisibility(): string {
    return this.config.get<string>('GITHUB_DEFAULT_VISIBILITY') ?? 'private';
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('GITHUB_TOKEN') && this.owner);
  }

  async createRepository(input: {
    owner: string;
    repoName: string;
    visibility: string;
    description?: string | null;
  }): Promise<GithubRepoResult> {
    const body = {
      name: input.repoName,
      description: input.description ?? undefined,
      private: input.visibility !== 'public',
      auto_init: true,
    };

    // Organisation accounts and personal accounts use different endpoints; try
    // the org one first and fall back when the owner is a user account.
    let response = await this.request(`/orgs/${input.owner}/repos`, {
      method: 'POST',
      body,
    });
    if (response.status === 404) {
      response = await this.request('/user/repos', { method: 'POST', body });
    }

    // GitHub answers 404 rather than 403 when the token cannot see an endpoint,
    // so spell out the two things that actually cause it.
    if (response.status === 404) {
      throw new ServiceUnavailableException(
        `GitHub refused to create ${input.owner}/${input.repoName}: check that GITHUB_TOKEN has the "repo" scope and that GITHUB_OWNER is correct`,
      );
    }

    const payload = await this.parse<GithubRepoResponse>(
      response,
      `create repository ${input.owner}/${input.repoName}`,
    );

    return {
      externalId: payload.id != null ? String(payload.id) : null,
      repoUrl:
        payload.html_url ??
        `https://github.com/${input.owner}/${input.repoName}`,
      defaultBranch: payload.default_branch ?? 'main',
    };
  }

  async findRepository(input: {
    owner: string;
    repoName: string;
  }): Promise<GithubRepoResult | null> {
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}`,
      { method: 'GET' },
    );
    if (response.status === 404) return null;
    const payload = await this.parse<GithubRepoResponse>(
      response,
      `read repository ${input.owner}/${input.repoName}`,
    );
    return {
      externalId: payload.id != null ? String(payload.id) : null,
      repoUrl:
        payload.html_url ??
        `https://github.com/${input.owner}/${input.repoName}`,
      defaultBranch: payload.default_branch ?? 'main',
    };
  }

  async inviteCollaborator(input: {
    owner: string;
    repoName: string;
    username: string;
    permission: string;
  }): Promise<GithubInviteResult> {
    const response = await this.request(
      `/repos/${input.owner}/${input.repoName}/collaborators/${input.username}`,
      { method: 'PUT', body: { permission: input.permission } },
    );

    if (response.status === 204) {
      return { alreadyCollaborator: true, inviteUrl: null, githubUserId: null };
    }

    const payload = await this.parse<GithubInviteResponse>(
      response,
      `invite ${input.username}`,
    );
    return {
      alreadyCollaborator: false,
      inviteUrl: payload.html_url ?? null,
      githubUserId:
        payload.invitee?.id != null ? String(payload.invitee.id) : null,
    };
  }

  async removeCollaborator(input: {
    owner: string;
    repoName: string;
    username: string;
  }): Promise<void> {
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/collaborators/${encodeURIComponent(input.username)}`,
      { method: 'DELETE' },
    );
    if (response.status === 204 || response.status === 404) return;
    await this.parse<unknown>(
      response,
      `remove collaborator ${input.username}`,
    );
  }

  async resolveCommit(input: {
    owner: string;
    repoName: string;
    ref: string;
  }): Promise<GithubCommitTarget> {
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/commits/${encodeURIComponent(input.ref)}`,
      { method: 'GET' },
    );
    const payload = await this.parse<GithubCommitResponse>(
      response,
      `resolve commit ${input.owner}/${input.repoName}@${input.ref}`,
    );
    const sha = payload.sha?.toLowerCase();
    if (!sha || !/^[a-f0-9]{40}$/.test(sha)) {
      throw new ServiceUnavailableException(
        'GitHub returned an invalid commit SHA',
      );
    }
    return { sha, url: payload.html_url ?? null };
  }

  async getPullRequest(input: {
    owner: string;
    repoName: string;
    number: number;
  }): Promise<GithubPullRequestTarget> {
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/pulls/${input.number}`,
      { method: 'GET' },
    );
    const payload = await this.parse<GithubPullRequestResponse>(
      response,
      `resolve pull request ${input.owner}/${input.repoName}#${input.number}`,
    );
    const headSha = payload.head?.sha?.toLowerCase();
    const baseSha = payload.base?.sha?.toLowerCase();
    if (
      !headSha ||
      !baseSha ||
      !/^[a-f0-9]{40}$/.test(headSha) ||
      !/^[a-f0-9]{40}$/.test(baseSha)
    ) {
      throw new ServiceUnavailableException(
        'GitHub returned invalid pull-request commit metadata',
      );
    }
    return {
      number: payload.number ?? input.number,
      url: payload.html_url ?? null,
      state: payload.state ?? null,
      draft: payload.draft === true,
      merged: payload.merged === true,
      mergeable:
        typeof payload.mergeable === 'boolean' ? payload.mergeable : null,
      mergeableState: payload.mergeable_state ?? null,
      mergeCommitSha:
        typeof payload.merge_commit_sha === 'string' &&
        /^[a-f0-9]{40}$/i.test(payload.merge_commit_sha)
          ? payload.merge_commit_sha.toLowerCase()
          : null,
      headSha,
      headRef: payload.head?.ref ?? null,
      baseSha,
      baseRef: payload.base?.ref ?? null,
    };
  }

  async updatePullRequestBase(input: {
    owner: string;
    repoName: string;
    number: number;
    baseRef: string;
    expectedHeadSha: string;
  }): Promise<GithubPullRequestTarget> {
    const current = await this.getPullRequest(input);
    if (current.headSha !== input.expectedHeadSha.toLowerCase()) {
      throw new ServiceUnavailableException(
        'GitHub pull-request head changed before its base could be updated',
      );
    }
    if (current.baseRef === input.baseRef) return current;
    if (current.state !== 'open' || current.draft) {
      throw new ServiceUnavailableException(
        'Only an open, ready pull request can be retargeted',
      );
    }

    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/pulls/${input.number}`,
      { method: 'PATCH', body: { base: input.baseRef } },
    );
    await this.parse<GithubPullRequestResponse>(
      response,
      `retarget pull request ${input.owner}/${input.repoName}#${input.number}`,
    );
    const updated = await this.getPullRequest(input);
    if (
      updated.headSha !== input.expectedHeadSha.toLowerCase() ||
      updated.baseRef !== input.baseRef
    ) {
      throw new ServiceUnavailableException(
        'GitHub did not preserve the evaluated head while updating the pull-request base',
      );
    }
    return updated;
  }

  async isCommitAncestor(input: {
    owner: string;
    repoName: string;
    ancestorSha: string;
    descendantSha: string;
  }): Promise<boolean> {
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/compare/${encodeURIComponent(input.ancestorSha)}...${encodeURIComponent(input.descendantSha)}`,
      { method: 'GET' },
    );
    const payload = await this.parse<GithubCompareResponse>(
      response,
      `compare commits ${input.owner}/${input.repoName}`,
    );
    return payload.status === 'ahead' || payload.status === 'identical';
  }

  async syncPullRequestWithBase(input: {
    owner: string;
    repoName: string;
    number: number;
    expectedHeadSha: string;
    requiredBaseRef: string;
  }): Promise<GithubPullRequestBranchSyncResult> {
    const current = await this.getPullRequest(input);
    if (current.headSha !== input.expectedHeadSha.toLowerCase()) {
      throw new ServiceUnavailableException(
        'GitHub pull-request head changed before its base could be synchronized',
      );
    }
    if (
      current.state !== 'open' ||
      current.draft ||
      current.baseRef !== input.requiredBaseRef
    ) {
      return {
        status: 'current',
        message: null,
        headSha: current.headSha,
        baseSha: current.baseSha,
      };
    }
    if (current.mergeable === false || current.mergeableState === 'dirty') {
      return {
        status: 'conflict',
        message: 'The feature branch conflicts with ' + input.requiredBaseRef,
        headSha: current.headSha,
        baseSha: current.baseSha,
      };
    }
    if (
      await this.isCommitAncestor({
        owner: input.owner,
        repoName: input.repoName,
        ancestorSha: current.baseSha,
        descendantSha: current.headSha,
      })
    ) {
      return {
        status: 'current',
        message: null,
        headSha: current.headSha,
        baseSha: current.baseSha,
      };
    }

    const response = await this.request(
      '/repos/' +
        encodeURIComponent(input.owner) +
        '/' +
        encodeURIComponent(input.repoName) +
        '/pulls/' +
        input.number +
        '/update-branch',
      {
        method: 'PUT',
        body: { expected_head_sha: current.headSha },
      },
    );
    if (response.status === 409 || response.status === 422) {
      const payload = (await response
        .json()
        .catch(() => ({}))) as GithubUpdatePullRequestBranchResponse;
      return {
        status: 'conflict',
        message:
          payload.message ??
          'GitHub could not update the feature branch from ' +
            input.requiredBaseRef,
        headSha: current.headSha,
        baseSha: current.baseSha,
      };
    }
    const payload = await this.parse<GithubUpdatePullRequestBranchResponse>(
      response,
      'update pull request branch ' +
        input.owner +
        '/' +
        input.repoName +
        '#' +
        input.number,
    );
    return {
      status: 'update_requested',
      message: payload.message ?? null,
      headSha: current.headSha,
      baseSha: current.baseSha,
    };
  }

  async mergePullRequest(input: {
    owner: string;
    repoName: string;
    number: number;
    expectedHeadSha: string;
    commitTitle?: string;
  }): Promise<GithubMergePullRequestResult> {
    const current = await this.getPullRequest(input);
    if (current.merged) {
      return {
        merged: true,
        sha: current.mergeCommitSha,
        message: 'Pull request was already merged',
      };
    }
    if (current.state !== 'open' || current.draft) {
      return {
        merged: false,
        sha: null,
        message: 'Pull request is not open and ready for integration',
      };
    }
    if (current.headSha !== input.expectedHeadSha.toLowerCase()) {
      return {
        merged: false,
        sha: null,
        message: 'Pull request head changed after approval',
      };
    }
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/pulls/${input.number}/merge`,
      {
        method: 'PUT',
        body: {
          sha: current.headSha,
          // Preserve prerequisite commit ancestry. Squashing an accepted base
          // task makes its descendants look unrelated and creates avoidable
          // conflicts in stacked implementation pull requests.
          merge_method: 'merge',
          commit_title:
            input.commitTitle ?? `Integrate approved work (#${input.number})`,
        },
      },
    );
    if (response.status === 405 || response.status === 409) {
      const payload = (await response
        .json()
        .catch(() => ({}))) as GithubMergePullRequestResponse;
      const latest = await this.getPullRequest(input);
      if (
        latest.merged &&
        latest.headSha === input.expectedHeadSha.toLowerCase()
      ) {
        return {
          merged: true,
          sha: latest.mergeCommitSha,
          message: 'Pull request was merged by a concurrent integration run',
        };
      }
      return {
        merged: false,
        sha: null,
        message:
          payload.message ??
          'GitHub reported that the pull request is not mergeable',
      };
    }
    const payload = await this.parse<GithubMergePullRequestResponse>(
      response,
      `merge pull request ${input.owner}/${input.repoName}#${input.number}`,
    );
    const sha =
      typeof payload.sha === 'string' && /^[a-f0-9]{40}$/i.test(payload.sha)
        ? payload.sha.toLowerCase()
        : null;
    return {
      merged: payload.merged === true,
      sha,
      message: payload.message ?? null,
    };
  }

  async inspectRepositorySnapshot(input: {
    owner: string;
    repoName: string;
    commitSha: string;
    baseCommitSha?: string | null;
    pullRequestNumber?: number | null;
    pullRequestUrl?: string | null;
    pullRequestState?: string | null;
    pullRequestDraft?: boolean;
  }): Promise<GithubReadOnlyInspection> {
    const root = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}`;
    const [tree, changedFiles, checks, combinedStatus] = await Promise.all([
      this.requestAndParse<GithubTreeResponse>(
        `${root}/git/trees/${encodeURIComponent(input.commitSha)}?recursive=1`,
        { method: 'GET' },
        `read source tree ${input.owner}/${input.repoName}@${input.commitSha}`,
      ),
      this.readChangedFiles(root, input),
      this.readOptionalInspectionSignal<GithubChecksResponse>(
        `${root}/commits/${encodeURIComponent(input.commitSha)}/check-runs?per_page=100`,
        `read checks for ${input.owner}/${input.repoName}@${input.commitSha}`,
        { total_count: 0, check_runs: [] },
      ),
      this.readOptionalInspectionSignal<GithubCombinedStatusResponse>(
        `${root}/commits/${encodeURIComponent(input.commitSha)}/status`,
        `read status for ${input.owner}/${input.repoName}@${input.commitSha}`,
        { statuses: [] },
      ),
    ]);

    const manifest = (tree.tree ?? [])
      .filter(
        (item) =>
          item.type === 'blob' &&
          typeof item.path === 'string' &&
          typeof item.sha === 'string',
      )
      .map((item) => ({
        path: item.path!,
        sizeBytes: item.size ?? null,
        sha: item.sha!,
      }));
    const manifestPaths = new Set(manifest.map((item) => item.path));
    const staticProject = this.isDependencyFreeStaticProject(manifestPaths);
    const materialChangedFiles = changedFiles.items.filter(
      (item) => !this.isGeneratedInspectionPath(item.path),
    );
    const preferred = [
      ...materialChangedFiles
        .filter((item) => item.status !== 'removed')
        .map((item) => item.path),
      ...manifest
        .filter((item) =>
          staticProject
            ? item.path.toLowerCase().endsWith('.html')
            : this.isProjectContextFile(item.path),
        )
        .map((item) => item.path),
    ];
    const selected = [...new Set(preferred)].slice(0, 100);
    const excerpts = await this.readSourceExcerpts(
      root,
      input.commitSha,
      selected,
    );
    const inspectedPaths = new Set(excerpts.map((item) => item.path));
    const removedWithPatch = new Set(
      materialChangedFiles
        .filter((item) => item.status === 'removed' && item.patch)
        .map((item) => item.path),
    );
    const changedPaths = new Set(materialChangedFiles.map((item) => item.path));
    const changedCovered = [...changedPaths].filter(
      (path) => inspectedPaths.has(path) || removedWithPatch.has(path),
    ).length;
    const changedFileCoverage = changedPaths.size
      ? changedCovered / changedPaths.size
      : 1;
    const verification = this.buildReadOnlyVerification(
      excerpts,
      manifestPaths,
      staticProject,
      checks,
      combinedStatus,
    );
    const githubChecks = this.githubChecks(checks, combinedStatus);
    const diff = materialChangedFiles
      .filter((item) => item.patch)
      .map((item) => `diff -- ${item.path}\n${item.patch}`)
      .join('\n');
    const diffTruncated = materialChangedFiles.some(
      (item) => item.status !== 'removed' && !item.patch,
    );
    const complete =
      changedFileCoverage === 1 &&
      !changedFiles.truncated &&
      tree.truncated !== true &&
      !diffTruncated &&
      verification.complete;
    const inspection = {
      schemaVersion: 1,
      sourceInspected: true,
      snapshotVerified: true,
      verificationComplete: verification.complete,
      complete,
      commitSha: input.commitSha,
      baseCommitSha: input.baseCommitSha ?? null,
      pullRequest: input.pullRequestNumber
        ? {
            number: input.pullRequestNumber,
            url: input.pullRequestUrl ?? null,
            state: input.pullRequestState ?? null,
            draft: input.pullRequestDraft === true,
            headSha: input.commitSha,
            baseSha: input.baseCommitSha ?? null,
          }
        : null,
      changedFiles: changedFiles.items,
      diff,
      diffTruncated,
      changedFilesTruncated: changedFiles.truncated,
      githubChecks,
      verification,
      sourceManifestSample: manifest.slice(0, 500),
      sourceManifestTruncated: manifest.length > 500 || tree.truncated === true,
      sourceExcerpts: excerpts,
      coverage: {
        manifestFiles: manifest.length,
        changedFiles: changedPaths.size,
        excludedGeneratedFiles:
          changedFiles.items.length - materialChangedFiles.length,
        inspectedFiles: excerpts.length,
        changedFileCoverage,
        sourceChars: excerpts.reduce(
          (total, item) => total + item.content.length,
          0,
        ),
      },
    };
    return {
      inspection,
      audit: {
        executionMode: 'http-readonly',
        snapshotVerified: true,
        verification,
        inspectionCoverage: inspection.coverage,
        githubChecks,
      },
    };
  }

  async ensureEvaluationWebhook(input: {
    owner: string;
    repoName: string;
  }): Promise<GithubWebhookResult> {
    const secret = this.config.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException(
        'GitHub webhooks are not configured (GITHUB_WEBHOOK_SECRET is missing)',
      );
    }
    const configuredUrl = this.config.get<string>('GITHUB_WEBHOOK_URL');
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const webhookUrl =
      configuredUrl ??
      (frontendUrl
        ? new URL('/api/repositories/webhooks/github', frontendUrl).toString()
        : null);
    if (!webhookUrl || !webhookUrl.startsWith('https://')) {
      throw new ServiceUnavailableException(
        'GITHUB_WEBHOOK_URL must be an HTTPS URL in production',
      );
    }
    const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/hooks`;
    const hooksResponse = await this.request(`${path}?per_page=100`, {
      method: 'GET',
    });
    const hooks = await this.parse<GithubWebhookResponse[]>(
      hooksResponse,
      `list webhooks for ${input.owner}/${input.repoName}`,
    );
    const webhookPath = new URL(webhookUrl).pathname.replace(/\/+$/, '');
    const existing =
      hooks.find((hook) => hook.config?.url === webhookUrl) ??
      hooks.find((hook) => {
        try {
          return (
            new URL(hook.config?.url ?? '').pathname.replace(/\/+$/, '') ===
            webhookPath
          );
        } catch {
          return false;
        }
      });
    const body = {
      name: 'web',
      active: true,
      events: [
        'push',
        'pull_request',
        'check_run',
        'check_suite',
        'workflow_run',
        'status',
      ],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    };
    const response = existing?.id
      ? await this.request(`${path}/${existing.id}`, {
          method: 'PATCH',
          body,
        })
      : await this.request(path, { method: 'POST', body });
    const hook = await this.parse<GithubWebhookResponse>(
      response,
      `configure evaluation webhook for ${input.owner}/${input.repoName}`,
    );
    return {
      id: hook.id != null ? String(hook.id) : null,
      url: hook.config?.url ?? webhookUrl,
      active: hook.active === true,
    };
  }

  async downloadRepositoryArchive(input: {
    owner: string;
    repoName: string;
    commitSha: string;
  }): Promise<GithubRepositoryArchive> {
    if (!/^[a-f0-9]{40}$/i.test(input.commitSha)) {
      throw new ServiceUnavailableException(
        'The verified repository commit is invalid',
      );
    }
    const response = await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repoName)}/zipball/${input.commitSha}`,
      {
        method: 'GET',
        timeoutMs: Number(
          this.config.get<string>('GITHUB_ARCHIVE_TIMEOUT_MS') ?? 120_000,
        ),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(
        `GitHub download repository archive failed (${response.status}): ${detail}`,
      );
      throw new ServiceUnavailableException(
        `GitHub download repository archive failed with status ${response.status}`,
      );
    }

    const configuredLimit = Number(
      this.config.get<string>('SOURCE_ARCHIVE_MAX_BYTES') ?? 100 * 1024 * 1024,
    );
    const maxBytes = Number.isFinite(configuredLimit)
      ? Math.min(500 * 1024 * 1024, Math.max(1024 * 1024, configuredLimit))
      : 100 * 1024 * 1024;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) {
      throw new ServiceUnavailableException(
        'The verified source archive is too large to download through Nexus',
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new ServiceUnavailableException(
        'The verified source archive is too large to download through Nexus',
      );
    }
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'application/zip',
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  private async request(
    path: string,
    init: {
      method: string;
      body?: Record<string, unknown>;
      timeoutMs?: number;
    },
  ) {
    const token = this.config.get<string>('GITHUB_TOKEN');
    if (!token) {
      throw new ServiceUnavailableException(
        'GitHub is not configured (GITHUB_TOKEN is missing)',
      );
    }
    const apiUrl =
      this.config.get<string>('GITHUB_API_URL') ?? 'https://api.github.com';
    const configuredTimeout = Number(
      init.timeoutMs ??
        this.config.get<string>('GITHUB_API_TIMEOUT_MS') ??
        30_000,
    );
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(120_000, Math.max(1_000, configuredTimeout))
      : 30_000;

    try {
      return await fetch(`${apiUrl}${path}`, {
        method: init.method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `GitHub request ${init.method} ${path} failed: ${message}`,
      );
      throw new ServiceUnavailableException(
        `GitHub is unreachable: ${message}`,
      );
    }
  }

  private requestAndParse<T>(
    path: string,
    init: { method: string; body?: Record<string, unknown> },
    operation: string,
  ): Promise<T> {
    return this.request(path, init).then((response) =>
      this.parse<T>(response, operation),
    );
  }

  private async readOptionalInspectionSignal<T>(
    path: string,
    operation: string,
    fallback: T,
  ): Promise<T> {
    const response = await this.request(path, { method: 'GET' });
    if (response.status === 403 || response.status === 404) {
      this.logger.warn(
        `GitHub ${operation} is unavailable (${response.status}); continuing with a human-verification evidence gap`,
      );
      return fallback;
    }
    return this.parse<T>(response, operation);
  }

  private async readChangedFiles(
    root: string,
    input: {
      commitSha: string;
      pullRequestNumber?: number | null;
    },
  ) {
    const path = input.pullRequestNumber
      ? `${root}/pulls/${input.pullRequestNumber}/files?per_page=100`
      : `${root}/commits/${encodeURIComponent(input.commitSha)}`;
    const response = await this.request(path, { method: 'GET' });
    const payload = input.pullRequestNumber
      ? await this.parse<GithubPullFileResponse[]>(response, 'read pull files')
      : ((
          await this.parse<{ files?: GithubPullFileResponse[] }>(
            response,
            'read commit files',
          )
        ).files ?? []);
    return {
      items: payload
        .filter((item) => typeof item.filename === 'string')
        .map((item) => ({
          path: item.filename!,
          previousPath: item.previous_filename ?? null,
          status: item.status ?? 'modified',
          additions: item.additions ?? 0,
          deletions: item.deletions ?? 0,
          changes: item.changes ?? 0,
          patch:
            typeof item.patch === 'string' ? item.patch.slice(0, 12_000) : null,
        })),
      truncated: payload.length >= 100,
    };
  }

  private async readSourceExcerpts(
    root: string,
    commitSha: string,
    paths: string[],
  ) {
    const excerpts: Array<{
      path: string;
      sha256: string;
      content: string;
      truncated: boolean;
    }> = [];
    let consumed = 0;
    for (
      let offset = 0;
      offset < paths.length && consumed < 350_000;
      offset += 5
    ) {
      const batch = paths.slice(offset, offset + 5);
      const results = await Promise.all(
        batch.map(async (path) => {
          try {
            const response = await this.request(
              `${root}/contents/${path
                .split('/')
                .map(encodeURIComponent)
                .join('/')}?ref=${encodeURIComponent(commitSha)}`,
              { method: 'GET' },
            );
            return await this.parse<GithubContentResponse>(
              response,
              `read ${path}@${commitSha}`,
            );
          } catch (error) {
            this.logger.warn(
              `Could not include ${path} in read-only inspection: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return null;
          }
        }),
      );
      for (let index = 0; index < results.length; index += 1) {
        const value = results[index];
        if (
          !value ||
          value.type !== 'file' ||
          value.encoding !== 'base64' ||
          typeof value.content !== 'string'
        ) {
          continue;
        }
        const bytes = Buffer.from(value.content.replace(/\s/g, ''), 'base64');
        if (bytes.includes(0)) continue;
        const raw = bytes.toString('utf8');
        const remaining = 350_000 - consumed;
        const text = raw.slice(0, Math.min(30_000, remaining));
        const numbered = text
          .split(/\r?\n/)
          .map((line, lineIndex) => `${lineIndex + 1}: ${line}`)
          .join('\n');
        consumed += numbered.length;
        excerpts.push({
          path: value.path ?? batch[index],
          sha256: createHash('sha256').update(bytes).digest('hex'),
          content: numbered,
          truncated: raw.length > text.length,
        });
      }
    }
    return excerpts;
  }

  private buildReadOnlyVerification(
    excerpts: Array<{ path: string; content: string }>,
    manifestPaths: Set<string>,
    staticProject: boolean,
    checks: GithubChecksResponse,
    combinedStatus: GithubCombinedStatusResponse,
  ) {
    const results: Array<Record<string, unknown>> = [];
    if (staticProject) {
      const html = excerpts.filter((item) =>
        item.path.toLowerCase().endsWith('.html'),
      );
      const missing: string[] = [];
      const referencePattern = /\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi;
      for (const file of html) {
        for (const match of file.content.matchAll(referencePattern)) {
          const reference = match[1].trim();
          if (
            !reference ||
            /^(?:#|data:|https?:|mailto:|tel:|javascript:)/i.test(reference)
          ) {
            continue;
          }
          const clean = reference.split(/[?#]/, 1)[0];
          if (!clean) continue;
          const candidate = clean.startsWith('/')
            ? posix.normalize(clean.slice(1))
            : posix.normalize(posix.join(posix.dirname(file.path), clean));
          if (candidate.startsWith('../') || !manifestPaths.has(candidate)) {
            missing.push(`${file.path}: ${reference}`);
          }
        }
      }
      results.push({
        project: '.',
        category: 'build',
        name: 'static-web-sanity',
        command: ['read-only-source-inspection'],
        status: html.length > 0 && missing.length === 0 ? 'passed' : 'failed',
        exitCode: html.length > 0 && missing.length === 0 ? 0 : 1,
        output:
          html.length === 0
            ? 'No inspectable HTML file was found.'
            : missing.length
              ? `Missing local assets: ${missing.join('; ')}`
              : `Validated ${html.length} HTML file(s) against the immutable GitHub tree.`,
      });
    }
    const checkRuns = checks.check_runs ?? [];
    const statuses = combinedStatus.statuses ?? [];
    const failed =
      checkRuns.some((item) =>
        ['failure', 'cancelled', 'timed_out', 'action_required'].includes(
          item.conclusion ?? '',
        ),
      ) ||
      statuses.some((item) => ['failure', 'error'].includes(item.state ?? ''));
    const pending =
      checkRuns.some((item) => item.status !== 'completed') ||
      statuses.some((item) => item.state === 'pending');
    if (checkRuns.length || statuses.length) {
      results.push({
        project: '.',
        category: 'test',
        name: 'github-checks',
        command: ['github-checks-api'],
        status: failed ? 'failed' : pending ? 'skipped' : 'passed',
        exitCode: failed ? 1 : pending ? null : 0,
        output: `Observed ${checkRuns.length} check run(s) and ${statuses.length} commit status(es).`,
      });
    }
    const complete =
      staticProject ||
      ((checkRuns.length > 0 || statuses.length > 0) && !pending);
    return {
      schemaVersion: 1,
      complete,
      mode: 'read_only',
      commandsAttempted: results.filter((item) => item.status !== 'skipped')
        .length,
      commandsFailed: results.filter((item) => item.status === 'failed').length,
      coverage: {
        install: false,
        test: checkRuns.length > 0 || statuses.length > 0,
        build: staticProject,
        lint: false,
        security: false,
      },
      results,
      limitation:
        'HTTP development mode inspects immutable GitHub source and checks but does not execute repository code.',
    };
  }

  private githubChecks(
    checks: GithubChecksResponse,
    combinedStatus: GithubCombinedStatusResponse,
  ) {
    return {
      checkRuns: (checks.check_runs ?? []).map((item) => ({
        name: item.name ?? null,
        status: item.status ?? null,
        conclusion: item.conclusion ?? null,
        url: item.html_url ?? null,
      })),
      combinedState: combinedStatus.state ?? null,
      statuses: (combinedStatus.statuses ?? []).map((item) => ({
        context: item.context ?? null,
        state: item.state ?? null,
        description: item.description ?? null,
        url: item.target_url ?? null,
      })),
      truncated:
        (checks.total_count ?? checks.check_runs?.length ?? 0) >
        (checks.check_runs?.length ?? 0),
    };
  }

  private isDependencyFreeStaticProject(paths: Set<string>) {
    const lower = [...paths].map((path) => path.toLowerCase());
    return (
      lower.some((path) => path.endsWith('.html')) &&
      !lower.some((path) =>
        [
          'package.json',
          'pyproject.toml',
          'requirements.txt',
          'setup.py',
          'go.mod',
          'cargo.toml',
          'pom.xml',
          'build.gradle',
        ].some((marker) => path === marker || path.endsWith(`/${marker}`)),
      )
    );
  }

  private isProjectContextFile(path: string) {
    const name = path.split('/').at(-1)?.toLowerCase();
    return [
      'readme.md',
      'package.json',
      'pyproject.toml',
      'requirements.txt',
      'dockerfile',
    ].includes(name ?? '');
  }

  private isGeneratedInspectionPath(path: string) {
    const normalized = path.toLowerCase().replaceAll('\\', '/');
    const name = normalized.split('/').at(-1) ?? '';
    if (
      [
        'package-lock.json',
        'npm-shrinkwrap.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lock',
        'bun.lockb',
        'composer.lock',
        'poetry.lock',
        'cargo.lock',
      ].includes(name)
    ) {
      return true;
    }
    return (
      /(^|\/)(?:node_modules|dist|build|coverage|\.next|\.nuxt|vendor|__snapshots__)(?:\/|$)/.test(
        normalized,
      ) || name.endsWith('.snap')
    );
  }

  private async parse<T>(response: Response, operation: string): Promise<T> {
    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(
        `GitHub ${operation} failed (${response.status}): ${detail}`,
      );
      if (response.status === 403 && /webhooks?/i.test(operation)) {
        throw new ServiceUnavailableException(
          `GitHub ${operation} failed with status 403. The configured fine-grained personal access token needs repository permission "Webhooks: Read and write" for this repository.`,
        );
      }
      throw new ServiceUnavailableException(
        `GitHub ${operation} failed with status ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }
}
