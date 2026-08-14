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
