import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { GithubWebhookEvent } from 'src/projects/entities/github-webhook-event.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { GithubService } from 'src/repositories/github.service';
import { EvaluationsService } from './evaluations.service';

const ACTIVE_SUBMISSION_STATUSES = ['submitted', 'under_review'];

@Injectable()
export class GithubWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly evaluations: EvaluationsService,
    private readonly github: GithubService,
    @InjectRepository(GithubWebhookEvent)
    private readonly eventRepo: Repository<GithubWebhookEvent>,
    @InjectRepository(ProjectRepository)
    private readonly repositoryRepo: Repository<ProjectRepository>,
    @InjectRepository(ProjectSubmission)
    private readonly submissionRepo: Repository<ProjectSubmission>,
  ) {}

  async handle(input: {
    rawBody: Buffer;
    signature: string;
    deliveryId: string;
    eventType: string;
  }) {
    this.verifySignature(input.rawBody, input.signature);
    if (!input.deliveryId || input.deliveryId.length > 120) {
      throw new BadRequestException('Missing or invalid GitHub delivery ID');
    }
    if (!input.eventType || input.eventType.length > 120) {
      throw new BadRequestException('Missing or invalid GitHub event type');
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(input.rawBody.toString('utf8'));
      payload = this.asRecord(parsed);
      if (!Object.keys(payload).length) throw new Error('empty object');
    } catch {
      throw new BadRequestException('GitHub webhook body is not valid JSON');
    }

    const existing = await this.eventRepo.findOne({
      where: { deliveryId: input.deliveryId },
    });
    if (existing?.processedAt) {
      return { received: true, duplicate: true, evaluationsQueued: 0 };
    }
    const repositoryFullName = this.string(
      this.asRecord(payload.repository).full_name,
    );
    let event: GithubWebhookEvent;
    if (existing) {
      const claimed = await this.claimExistingEvent(existing.id);
      if (!claimed) {
        return { received: true, duplicate: true, evaluationsQueued: 0 };
      }
      event = existing;
    } else {
      try {
        event = await this.eventRepo.save(
          this.eventRepo.create({
            deliveryId: input.deliveryId,
            eventType: input.eventType,
            repositoryFullName,
            payload: this.compactPayload(payload),
            processingStartedAt: new Date(),
          }),
        );
      } catch (error) {
        // Simultaneous GitHub retries can both pass the first lookup. The
        // delivery-id unique index elects one processor; acknowledge the loser.
        if (this.isUniqueViolation(error)) {
          return { received: true, duplicate: true, evaluationsQueued: 0 };
        }
        throw error;
      }
    }

    try {
      const evaluationsQueued = await this.processEvent(
        input.eventType,
        payload,
      );
      await this.eventRepo.update(event.id, {
        processedAt: new Date(),
        processingStartedAt: null,
        processingError: null,
      });
      return { received: true, duplicate: false, evaluationsQueued };
    } catch (error) {
      await this.eventRepo.update(event.id, {
        processingStartedAt: null,
        processingError:
          error instanceof Error ? error.message : 'Unknown webhook error',
      });
      throw error;
    }
  }

  private async claimExistingEvent(id: string) {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const result = await this.eventRepo
      .createQueryBuilder()
      .update(GithubWebhookEvent)
      .set({ processingStartedAt: new Date(), processingError: null })
      .where('id = :id', { id })
      .andWhere('processed_at IS NULL')
      .andWhere(
        '(processing_started_at IS NULL OR processing_started_at < :staleBefore)',
        { staleBefore },
      )
      .execute();
    return result.affected === 1;
  }

  private isUniqueViolation(error: unknown) {
    const value = error as {
      code?: string;
      driverError?: { code?: string };
    };
    return value.code === '23505' || value.driverError?.code === '23505';
  }

  private compactPayload(payload: Record<string, unknown>) {
    const repository = this.asRecord(payload.repository);
    const pullRequest = this.asRecord(payload.pull_request);
    const compactReference = (value: unknown) => {
      const reference = this.asRecord(value);
      return {
        sha: this.string(reference.sha),
        ref: this.string(reference.ref),
      };
    };
    return {
      action: this.string(payload.action),
      ref: this.string(payload.ref),
      after: this.string(payload.after),
      sha: this.string(payload.sha),
      state: this.string(payload.state),
      number: typeof payload.number === 'number' ? payload.number : null,
      deleted: payload.deleted === true,
      repository: {
        fullName: this.string(repository.full_name),
        name: this.string(repository.name),
        owner: this.string(this.asRecord(repository.owner).login),
      },
      pullRequest: {
        head: compactReference(pullRequest.head),
        base: compactReference(pullRequest.base),
      },
      checkRun: {
        headSha: this.string(this.asRecord(payload.check_run).head_sha),
      },
      checkSuite: {
        headSha: this.string(this.asRecord(payload.check_suite).head_sha),
      },
      workflowRun: {
        headSha: this.string(this.asRecord(payload.workflow_run).head_sha),
      },
    };
  }

  private verifySignature(rawBody: Buffer, signature: string) {
    const secret = this.config.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException(
        'GitHub webhook verification is not configured',
      );
    }
    if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
    );
    const received = Buffer.from(signature.toLowerCase());
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
  }

  private async processEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    if (eventType === 'ping') return 0;
    const repository = await this.resolveRepository(payload);
    if (!repository) return 0;
    const target = this.eventTarget(eventType, payload);
    if (!target) return 0;

    const submissions = await this.findTargetSubmissions(repository, target);
    let queued = 0;
    for (const submission of submissions) {
      const approvedIntegrationRecovery =
        submission.status === 'approved' &&
        this.integrationStatus(submission) === 'failed' &&
        submission.commitSha?.toLowerCase() !== target.commitSha;
      if (submission.status === 'approved' && !approvedIntegrationRecovery) {
        continue;
      }
      if (
        approvedIntegrationRecovery &&
        submission.commitSha &&
        !(await this.github.isCommitAncestor({
          owner: repository.owner,
          repoName: repository.repoName,
          ancestorSha: submission.commitSha,
          descendantSha: target.commitSha,
        }))
      ) {
        continue;
      }
      const result = await this.evaluations.requeueForRepositoryUpdate({
        submissionId: submission.id,
        commitSha: target.commitSha,
        reason: `github_${eventType}_${target.action}`,
        allowApprovedIntegrationRecovery: approvedIntegrationRecovery,
      });
      if (result && (!('reused' in result) || result.reused !== true))
        queued += 1;
    }
    return queued;
  }

  private async resolveRepository(payload: Record<string, unknown>) {
    const repository = this.asRecord(payload.repository);
    const owner = this.string(this.asRecord(repository.owner).login);
    const repoName = this.string(repository.name);
    if (!owner || !repoName) return null;
    return this.repositoryRepo
      .createQueryBuilder('repository')
      .where('LOWER(repository.owner) = LOWER(:owner)', { owner })
      .andWhere('LOWER(repository.repoName) = LOWER(:repoName)', { repoName })
      .andWhere('repository.provider = :provider', { provider: 'github' })
      .andWhere('repository.status = :status', { status: 'active' })
      .getOne();
  }

  private eventTarget(eventType: string, payload: Record<string, unknown>) {
    const action = this.string(payload.action) ?? 'updated';
    if (eventType === 'push') {
      if (payload.deleted === true) return null;
      const ref = this.string(payload.ref);
      const commitSha = this.validSha(payload.after);
      if (!ref?.startsWith('refs/heads/') || !commitSha) return null;
      return {
        action: 'push',
        commitSha,
        branch: ref.slice('refs/heads/'.length),
        pullRequestNumber: null,
      };
    }
    if (eventType === 'pull_request') {
      if (
        ![
          'opened',
          'reopened',
          'synchronize',
          'ready_for_review',
          'edited',
        ].includes(action)
      ) {
        return null;
      }
      const pull = this.asRecord(payload.pull_request);
      const commitSha = this.validSha(this.asRecord(pull.head).sha);
      const number = Number(payload.number);
      if (!commitSha || !Number.isSafeInteger(number) || number <= 0) {
        return null;
      }
      return {
        action,
        commitSha,
        branch: this.string(this.asRecord(pull.head).ref),
        pullRequestNumber: number,
      };
    }
    if (eventType === 'check_run') {
      if (action !== 'completed') return null;
      const commitSha = this.validSha(
        this.asRecord(payload.check_run).head_sha,
      );
      return commitSha
        ? { action, commitSha, branch: null, pullRequestNumber: null }
        : null;
    }
    if (eventType === 'check_suite') {
      if (action !== 'completed') return null;
      const commitSha = this.validSha(
        this.asRecord(payload.check_suite).head_sha,
      );
      return commitSha
        ? { action, commitSha, branch: null, pullRequestNumber: null }
        : null;
    }
    if (eventType === 'workflow_run') {
      if (action !== 'completed') return null;
      const commitSha = this.validSha(
        this.asRecord(payload.workflow_run).head_sha,
      );
      return commitSha
        ? { action, commitSha, branch: null, pullRequestNumber: null }
        : null;
    }
    if (eventType === 'status') {
      const state = this.string(payload.state);
      if (!state || !['success', 'failure', 'error'].includes(state)) {
        return null;
      }
      const commitSha = this.validSha(payload.sha);
      return commitSha
        ? { action: state, commitSha, branch: null, pullRequestNumber: null }
        : null;
    }
    return null;
  }

  private async findTargetSubmissions(
    repository: ProjectRepository,
    target: {
      commitSha: string;
      branch: string | null;
      pullRequestNumber: number | null;
    },
  ) {
    const qb = this.submissionRepo
      .createQueryBuilder('submission')
      .where('submission.repositoryId = :repositoryId', {
        repositoryId: repository.id,
      })
      .andWhere('submission.status IN (:...statuses)', {
        statuses: [...ACTIVE_SUBMISSION_STATUSES, 'approved'],
      });
    if (target.pullRequestNumber) {
      qb.andWhere('submission.pullRequestUrl ~ :pullPattern', {
        pullPattern: `/pull/${target.pullRequestNumber}/?([?#].*)?$`,
      });
    } else if (target.branch) {
      qb.andWhere(
        '(submission.branchName = :branch OR submission.commitSha = :commitSha)',
        { branch: target.branch, commitSha: target.commitSha },
      );
    } else {
      qb.andWhere('submission.commitSha = :commitSha', {
        commitSha: target.commitSha,
      });
    }
    return qb.getMany();
  }

  private validSha(value: unknown) {
    const sha = this.string(value)?.toLowerCase();
    return sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null;
  }

  private integrationStatus(submission: ProjectSubmission) {
    const integration = submission.metadata?.integration;
    if (!integration || typeof integration !== 'object') return null;
    const status = (integration as Record<string, unknown>).status;
    return typeof status === 'string' ? status : null;
  }

  private string(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
