import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  head?: { sha?: string; ref?: string };
  base?: { sha?: string; ref?: string };
};

export type GithubCommitTarget = {
  sha: string;
  url: string | null;
};

export type GithubPullRequestTarget = {
  number: number;
  url: string | null;
  state: string | null;
  draft: boolean;
  headSha: string;
  headRef: string | null;
  baseSha: string;
  baseRef: string | null;
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
      headSha,
      headRef: payload.head?.ref ?? null,
      baseSha,
      baseRef: payload.base?.ref ?? null,
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

  private async request(
    path: string,
    init: { method: string; body?: Record<string, unknown> },
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
      this.config.get<string>('GITHUB_API_TIMEOUT_MS') ?? 30_000,
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

  private async parse<T>(response: Response, operation: string): Promise<T> {
    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(
        `GitHub ${operation} failed (${response.status}): ${detail}`,
      );
      throw new ServiceUnavailableException(
        `GitHub ${operation} failed with status ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }
}
