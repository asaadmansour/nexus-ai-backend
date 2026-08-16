import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { Repository } from 'typeorm';
import {
  AiService,
  type EvaluateSubmissionResult,
} from 'src/agents/ai.service';
import type { EvaluateSubmissionDto } from 'src/agents/dto/EvaluateSubmissionDto';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { GithubService } from 'src/repositories/github.service';

const RESULT_MARKER = 'NEXUS_EVALUATION_RESULT:';
const AUDIT_MARKER = 'NEXUS_EVALUATION_AUDIT:';

export interface ImplementationEvaluationExecution {
  result: EvaluateSubmissionResult;
  auditBundle: Record<string, unknown>;
  evaluatedCommitSha: string | null;
}

interface GithubEvaluationTarget {
  owner: string;
  repoName: string;
  commitSha: string;
  baseCommitSha: string | null;
  pullRequestNumber: number | null;
}

@Injectable()
export class ImplementationEvaluationSandboxService {
  private readonly logger = new Logger(
    ImplementationEvaluationSandboxService.name,
  );

  constructor(
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    private readonly github: GithubService,
    @InjectRepository(ProjectRepository)
    private readonly repositoryRepo: Repository<ProjectRepository>,
    @InjectRepository(ProjectSubmission)
    private readonly submissionRepo: Repository<ProjectSubmission>,
  ) {}

  async evaluate(
    dto: EvaluateSubmissionDto,
    agentJobId: string,
  ): Promise<ImplementationEvaluationExecution> {
    const target = await this.resolveTarget(dto);
    const resolvedDto = this.withResolvedTarget(dto, target);
    if (target) await this.pinResolvedCommit(dto, target);
    const sandboxMode = this.config.get<string>('EVALUATION_SANDBOX_MODE');

    if (!target || sandboxMode !== 'kubernetes') {
      const result = await this.aiService.evaluateSubmission(resolvedDto);
      return {
        result,
        evaluatedCommitSha:
          target?.commitSha ?? dto.submission.commitSha ?? null,
        auditBundle: this.buildHttpAudit(
          resolvedDto,
          result,
          agentJobId,
          target,
        ),
      };
    }

    const execution = await this.runKubernetesJob(
      resolvedDto,
      agentJobId,
      target,
    );
    const result = this.aiService.normalizeEvaluateSubmissionSandboxResult(
      execution.raw,
    );
    return {
      result,
      evaluatedCommitSha: target.commitSha,
      auditBundle: this.buildKubernetesAudit(
        resolvedDto,
        result,
        agentJobId,
        target,
        execution.logs,
        execution.audit,
      ),
    };
  }

  private async pinResolvedCommit(
    dto: EvaluateSubmissionDto,
    target: GithubEvaluationTarget,
  ) {
    await this.submissionRepo
      .createQueryBuilder()
      .update(ProjectSubmission)
      .set({ commitSha: target.commitSha })
      .where('id = :submissionId', {
        submissionId: dto.submission.submissionId,
      })
      .andWhere('project_id = :projectId', {
        projectId: dto.project.projectId,
      })
      .andWhere('(commit_sha IS NULL OR commit_sha = :submittedCommitSha)', {
        submittedCommitSha: dto.submission.commitSha,
      })
      .execute();
  }

  private async resolveTarget(
    dto: EvaluateSubmissionDto,
  ): Promise<GithubEvaluationTarget | null> {
    if (!['repo', 'pull_request'].includes(dto.submission.submissionType)) {
      return null;
    }
    const repository = dto.submission.repositoryId
      ? await this.repositoryRepo.findOne({
          where: {
            id: dto.submission.repositoryId,
            projectId: dto.project.projectId,
          },
        })
      : await this.repositoryRepo.findOne({
          where: { projectId: dto.project.projectId, status: 'active' },
        });
    if (!repository || repository.provider !== 'github') {
      throw new BadRequestException(
        'Implementation evaluation requires the active project GitHub repository',
      );
    }
    this.assertRepositoryUrl(dto.submission.repositoryUrl, repository);

    if (dto.submission.submissionType === 'pull_request') {
      const parsed = parseGithubPullRequestUrl(dto.submission.pullRequestUrl);
      if (
        !parsed ||
        parsed.owner.toLowerCase() !== repository.owner.toLowerCase() ||
        parsed.repoName.toLowerCase() !== repository.repoName.toLowerCase()
      ) {
        throw new BadRequestException(
          'The pull request must belong to the project repository',
        );
      }
      const pull = await this.github.getPullRequest({
        owner: repository.owner,
        repoName: repository.repoName,
        number: parsed.number,
      });
      if (
        dto.submission.commitSha &&
        dto.submission.commitSha.toLowerCase() !== pull.headSha
      ) {
        throw new BadRequestException(
          'The submitted commit SHA does not match the current pull-request head',
        );
      }
      return {
        owner: repository.owner,
        repoName: repository.repoName,
        commitSha: pull.headSha,
        baseCommitSha: pull.baseSha,
        pullRequestNumber: pull.number,
      };
    }

    if (!dto.submission.commitSha) {
      throw new BadRequestException(
        'Repository submissions must pin an exact commit SHA',
      );
    }
    const commit = await this.github.resolveCommit({
      owner: repository.owner,
      repoName: repository.repoName,
      ref: dto.submission.commitSha,
    });
    return {
      owner: repository.owner,
      repoName: repository.repoName,
      commitSha: commit.sha,
      baseCommitSha: null,
      pullRequestNumber: null,
    };
  }

  private assertRepositoryUrl(
    submittedUrl: string | null | undefined,
    repository: ProjectRepository,
  ) {
    if (!submittedUrl) return;
    const parsed = parseGithubRepositoryUrl(submittedUrl);
    if (
      !parsed ||
      parsed.owner.toLowerCase() !== repository.owner.toLowerCase() ||
      parsed.repoName.toLowerCase() !== repository.repoName.toLowerCase()
    ) {
      throw new BadRequestException(
        'The submitted repository URL does not match the project repository',
      );
    }
  }

  private withResolvedTarget(
    dto: EvaluateSubmissionDto,
    target: GithubEvaluationTarget | null,
  ): EvaluateSubmissionDto {
    if (!target) return dto;
    return {
      ...dto,
      submission: {
        ...dto.submission,
        repositoryOwner: target.owner,
        repositoryName: target.repoName,
        pullRequestNumber: target.pullRequestNumber,
        commitSha: target.commitSha,
        baseCommitSha: target.baseCommitSha,
      },
    };
  }

  private async runKubernetesJob(
    dto: EvaluateSubmissionDto,
    agentJobId: string,
    target: GithubEvaluationTarget,
  ) {
    const namespace = await this.namespace();
    const jobName = `implementation-eval-${agentJobId.replaceAll('-', '').slice(0, 16)}-${randomUUID().slice(0, 8)}`;
    const encoded = Buffer.from(JSON.stringify(dto)).toString('base64');
    const maxInputBytes = Number(
      this.config.get<string>('EVALUATION_SANDBOX_MAX_INPUT_BYTES') ?? 600_000,
    );
    if (Buffer.byteLength(encoded) > maxInputBytes) {
      throw new ServiceUnavailableException(
        'Implementation evaluation context is too large for the sandbox contract',
      );
    }
    const image = await this.resolveAiImage(namespace);
    await this.kubeRequest(
      'POST',
      `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`,
      this.jobManifest(namespace, jobName, image, encoded, target),
    );
    try {
      return await this.waitForResult(namespace, jobName);
    } finally {
      await this.kubeRequest(
        'DELETE',
        `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(jobName)}`,
        { propagationPolicy: 'Background' },
      ).catch((error: unknown) =>
        this.logger.warn(
          `Could not clean implementation sandbox ${jobName}: ${this.errorMessage(error)}`,
        ),
      );
    }
  }

  private jobManifest(
    namespace: string,
    jobName: string,
    image: string,
    encodedRequest: string,
    target: GithubEvaluationTarget,
  ) {
    const restrictedSecurityContext = {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ['ALL'] },
    };
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace,
        labels: { app: 'implementation-evaluation-sandbox' },
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: 1_200,
        ttlSecondsAfterFinished: 300,
        template: {
          metadata: {
            labels: {
              app: 'implementation-evaluation-sandbox',
              'evaluation-job': jobName,
            },
          },
          spec: {
            restartPolicy: 'Never',
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              seccompProfile: { type: 'RuntimeDefault' },
            },
            initContainers: [
              {
                name: 'snapshot',
                image,
                imagePullPolicy: 'IfNotPresent',
                command: ['python', '-m', 'app.runners.github_snapshot'],
                env: [
                  { name: 'HOME', value: '/tmp' },
                  { name: 'GITHUB_REPOSITORY_OWNER', value: target.owner },
                  { name: 'GITHUB_REPOSITORY_NAME', value: target.repoName },
                  { name: 'GITHUB_COMMIT_SHA', value: target.commitSha },
                  {
                    name: 'GITHUB_PULL_REQUEST_NUMBER',
                    value: target.pullRequestNumber?.toString() ?? '',
                  },
                  {
                    name: 'GITHUB_API_URL',
                    value:
                      this.config.get<string>('GITHUB_API_URL') ??
                      'https://api.github.com',
                  },
                  {
                    name: 'GITHUB_TOKEN',
                    valueFrom: {
                      secretKeyRef: {
                        name: 'nexus-secret',
                        key: 'GITHUB_TOKEN',
                      },
                    },
                  },
                ],
                resources: {
                  requests: { cpu: '250m', memory: '256Mi' },
                  limits: { cpu: '1', memory: '1Gi' },
                },
                securityContext: restrictedSecurityContext,
                volumeMounts: [
                  { name: 'scratch', mountPath: '/tmp' },
                  { name: 'snapshot-work', mountPath: '/workspace/snapshot' },
                  { name: 'source', mountPath: '/workspace/source' },
                  {
                    name: 'snapshot-evidence',
                    mountPath: '/workspace/evidence',
                  },
                ],
              },
              {
                name: 'verify',
                image,
                imagePullPolicy: 'IfNotPresent',
                command: [
                  'python',
                  '-m',
                  'app.runners.implementation_verification',
                ],
                env: [
                  { name: 'HOME', value: '/workspace/work/home' },
                  { name: 'CI', value: 'true' },
                ],
                resources: {
                  requests: { cpu: '500m', memory: '512Mi' },
                  limits: { cpu: '2', memory: '3Gi' },
                },
                securityContext: restrictedSecurityContext,
                volumeMounts: [
                  {
                    name: 'source',
                    mountPath: '/workspace/source',
                    readOnly: true,
                  },
                  { name: 'work', mountPath: '/workspace/work' },
                  {
                    name: 'verification-evidence',
                    mountPath: '/workspace/evidence',
                  },
                  { name: 'scratch', mountPath: '/tmp' },
                ],
              },
            ],
            containers: [
              {
                name: 'evaluator',
                image,
                imagePullPolicy: 'IfNotPresent',
                command: [
                  'python',
                  '-m',
                  'app.runners.implementation_evaluation',
                ],
                env: [
                  { name: 'HOME', value: '/tmp' },
                  { name: 'EVALUATION_REQUEST_B64', value: encodedRequest },
                  {
                    name: 'GEMINI_API_KEY',
                    valueFrom: {
                      secretKeyRef: {
                        name: 'nexus-secret',
                        key: 'GEMINI_API_KEY',
                      },
                    },
                  },
                  {
                    name: 'GEMINI_MODEL',
                    valueFrom: {
                      configMapKeyRef: {
                        name: 'nexus-config',
                        key: 'GEMINI_MODEL',
                      },
                    },
                  },
                ],
                resources: {
                  requests: { cpu: '500m', memory: '768Mi' },
                  limits: { cpu: '2', memory: '3Gi' },
                },
                securityContext: restrictedSecurityContext,
                volumeMounts: [
                  {
                    name: 'source',
                    mountPath: '/workspace/source',
                    readOnly: true,
                  },
                  {
                    name: 'snapshot-evidence',
                    mountPath: '/workspace/snapshot-evidence',
                    readOnly: true,
                  },
                  {
                    name: 'verification-evidence',
                    mountPath: '/workspace/verification-evidence',
                    readOnly: true,
                  },
                  { name: 'output', mountPath: '/workspace/output' },
                  { name: 'scratch', mountPath: '/tmp' },
                ],
              },
            ],
            volumes: [
              { name: 'source', emptyDir: { sizeLimit: '512Mi' } },
              { name: 'snapshot-work', emptyDir: { sizeLimit: '1Gi' } },
              { name: 'work', emptyDir: { sizeLimit: '2Gi' } },
              {
                name: 'snapshot-evidence',
                emptyDir: { sizeLimit: '64Mi' },
              },
              {
                name: 'verification-evidence',
                emptyDir: { sizeLimit: '16Mi' },
              },
              { name: 'output', emptyDir: { sizeLimit: '8Mi' } },
              {
                name: 'scratch',
                emptyDir: { medium: 'Memory', sizeLimit: '256Mi' },
              },
            ],
          },
        },
      },
    };
  }

  private async waitForResult(namespace: string, jobName: string) {
    const timeoutMs = Number(
      this.config.get<string>('IMPLEMENTATION_EVALUATION_TIMEOUT_MS') ??
        1_200_000,
    );
    const deadline = Date.now() + timeoutMs;
    const path = `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(jobName)}`;
    while (Date.now() < deadline) {
      const job = await this.kubeRequest('GET', path);
      const status = this.asRecord(job.status);
      if (Number(status.succeeded ?? 0) > 0) {
        const logs = await this.podLogs(namespace, jobName);
        return {
          raw: this.parseMarkedObject(logs, RESULT_MARKER, true),
          audit: this.parseMarkedObject(logs, AUDIT_MARKER, false),
          logs,
        };
      }
      if (Number(status.failed ?? 0) > 0) {
        const logs = await this.podLogs(namespace, jobName).catch(() => '');
        throw new ServiceUnavailableException(
          `Implementation evaluation sandbox failed${logs ? `: ${logs.slice(-1500)}` : ''}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new ServiceUnavailableException(
      'Implementation evaluation sandbox timed out',
    );
  }

  private async podLogs(namespace: string, jobName: string) {
    const selector = encodeURIComponent(`job-name=${jobName}`);
    const pods = await this.kubeRequest(
      'GET',
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${selector}`,
    );
    const items = Array.isArray(pods.items) ? pods.items : [];
    const metadata = this.asRecord(this.asRecord(items[0]).metadata);
    const name = typeof metadata.name === 'string' ? metadata.name : null;
    if (!name) throw new Error('Implementation evaluation pod was not found');
    return this.kubeRequest(
      'GET',
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log?container=evaluator`,
      undefined,
      true,
    );
  }

  private parseMarkedObject(
    logs: string,
    marker: string,
    required: boolean,
  ): Record<string, unknown> {
    const line = logs
      .split(/\r?\n/)
      .reverse()
      .find((candidate) => candidate.startsWith(marker));
    if (!line) {
      if (!required) return {};
      throw new ServiceUnavailableException(
        'Implementation sandbox completed without a structured result',
      );
    }
    try {
      const value: unknown = JSON.parse(
        Buffer.from(line.slice(marker.length), 'base64').toString('utf8'),
      );
      return this.asRecord(value);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Implementation sandbox returned invalid evidence: ${this.errorMessage(error)}`,
      );
    }
  }

  private buildHttpAudit(
    dto: EvaluateSubmissionDto,
    result: EvaluateSubmissionResult,
    agentJobId: string,
    target: GithubEvaluationTarget | null,
  ) {
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      executionMode: 'http',
      agentJobId,
      submissionId: dto.submission.submissionId,
      commitSha: target?.commitSha ?? dto.submission.commitSha ?? null,
      baseCommitSha: target?.baseCommitSha ?? null,
      snapshotVerified: false,
      verification: { complete: false, reason: 'sandbox_not_enabled' },
      verdictSha256: this.hash(this.canonicalJson(result)),
      evaluationInputHash: this.hash(this.canonicalJson(dto)),
    };
  }

  private buildKubernetesAudit(
    dto: EvaluateSubmissionDto,
    result: EvaluateSubmissionResult,
    agentJobId: string,
    target: GithubEvaluationTarget,
    logs: string,
    runnerAudit: Record<string, unknown>,
  ) {
    const sanitizedLogs = this.sanitizeLogs(logs);
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      executionMode: 'kubernetes',
      agentJobId,
      submissionId: dto.submission.submissionId,
      commitSha: target.commitSha,
      baseCommitSha: target.baseCommitSha,
      pullRequestNumber: target.pullRequestNumber,
      snapshotVerified: runnerAudit.snapshotVerified === true,
      sourceManifestHash: runnerAudit.sourceManifestHash ?? null,
      verification: runnerAudit.verification ?? null,
      inspectionCoverage: runnerAudit.inspectionCoverage ?? null,
      githubChecks: runnerAudit.githubChecks ?? null,
      summaryMarkdown: runnerAudit.summaryMarkdown ?? null,
      verdictSha256: this.hash(this.canonicalJson(result)),
      evaluationInputHash:
        runnerAudit.evaluationInputHash ?? this.hash(this.canonicalJson(dto)),
      sandboxLog: {
        sha256: this.hash(logs),
        excerpt: sanitizedLogs.value,
        truncated: sanitizedLogs.truncated,
        redacted: sanitizedLogs.redacted,
      },
    };
  }

  private sanitizeLogs(logs: string) {
    let value = logs
      .replace(
        new RegExp(`(${RESULT_MARKER}|${AUDIT_MARKER})[^\\r\\n]+`, 'g'),
        '$1[redacted structured payload]',
      )
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
      .replace(
        /(api[_-]?key|token|secret|password)(\s*[=:]\s*)[^\s,;]+/gi,
        '$1$2[redacted]',
      );
    const redacted = value !== logs;
    const truncated = value.length > 30_000;
    if (truncated) value = value.slice(-30_000);
    return { value, truncated, redacted };
  }

  private async resolveAiImage(namespace: string) {
    const configured =
      this.config.get<string>('IMPLEMENTATION_EVALUATION_SANDBOX_IMAGE') ??
      this.config.get<string>('EVALUATION_SANDBOX_IMAGE');
    if (configured) return configured;
    const deployment = await this.kubeRequest(
      'GET',
      `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/ai-service`,
    );
    const spec = this.asRecord(deployment.spec);
    const template = this.asRecord(spec.template);
    const podSpec = this.asRecord(template.spec);
    const containers = Array.isArray(podSpec.containers)
      ? podSpec.containers
      : [];
    const aiContainer = containers
      .map((item) => this.asRecord(item))
      .find((item) => item.name === 'ai-service');
    if (!aiContainer || typeof aiContainer.image !== 'string') {
      throw new ServiceUnavailableException(
        'Could not resolve the deployed implementation sandbox image',
      );
    }
    return aiContainer.image;
  }

  private async namespace() {
    const configured = this.config.get<string>('EVALUATION_SANDBOX_NAMESPACE');
    if (configured) return configured;
    return (
      await readFile(
        '/var/run/secrets/kubernetes.io/serviceaccount/namespace',
        'utf8',
      )
    ).trim();
  }

  private async kubeRequest(
    method: string,
    path: string,
    body: Record<string, unknown> | undefined,
    raw: true,
  ): Promise<string>;
  private async kubeRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    raw?: false,
  ): Promise<Record<string, unknown>>;
  private async kubeRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    raw = false,
  ): Promise<Record<string, unknown> | string> {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = Number(process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? 443);
    if (!host) {
      throw new ServiceUnavailableException(
        'Kubernetes sandbox mode requires in-cluster service credentials',
      );
    }
    const [token, ca] = await Promise.all([
      readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8'),
      readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),
    ]);
    const payload = body ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        {
          hostname: host,
          port,
          path,
          method,
          ca,
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            Accept: raw ? 'text/plain' : 'application/json',
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
          },
          timeout: 30_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 6 * 1024 * 1024) {
              response.destroy(
                new Error('Kubernetes response exceeded the size limit'),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = response.statusCode ?? 500;
            if (status < 200 || status >= 300) {
              reject(
                new Error(`Kubernetes API ${status}: ${text.slice(0, 1000)}`),
              );
              return;
            }
            if (raw) {
              resolve(text);
              return;
            }
            try {
              resolve(this.asRecord(text ? JSON.parse(text) : {}));
            } catch {
              reject(new Error('Kubernetes API returned invalid JSON'));
            }
          });
        },
      );
      request.on('timeout', () =>
        request.destroy(new Error('Kubernetes API timed out')),
      );
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`)
      .join(',')}}`;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function parseGithubRepositoryUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0],
      repoName: parts[1].replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}

export function parseGithubPullRequestUrl(value: string | null | undefined) {
  const repository = parseGithubRepositoryUrl(value);
  if (!repository || !value) return null;
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    if (parts[2] !== 'pull' || !/^\d+$/.test(parts[3] ?? '')) return null;
    const number = Number(parts[3]);
    if (!Number.isSafeInteger(number) || number <= 0) return null;
    return { ...repository, number };
  } catch {
    return null;
  }
}
