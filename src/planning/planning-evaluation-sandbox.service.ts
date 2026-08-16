import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import {
  AiService,
  type PlanningEvaluationResult,
} from 'src/agents/ai.service';
import type { EvaluatePlanningSubmissionDto } from 'src/agents/dto/EvaluatePlanningSubmissionDto';

const RESULT_MARKER = 'NEXUS_EVALUATION_RESULT:';
const AUDIT_MARKER = 'NEXUS_EVALUATION_AUDIT:';

export interface PlanningEvaluationExecution {
  result: PlanningEvaluationResult;
  auditBundle: Record<string, unknown>;
}

@Injectable()
export class PlanningEvaluationSandboxService {
  private readonly logger = new Logger(PlanningEvaluationSandboxService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly aiService: AiService,
  ) {}

  async evaluate(
    dto: EvaluatePlanningSubmissionDto,
    agentJobId: string,
  ): Promise<PlanningEvaluationExecution> {
    if (this.config.get<string>('EVALUATION_SANDBOX_MODE') !== 'kubernetes') {
      const result = await this.aiService.evaluatePlanningSubmission(dto);
      return {
        result,
        auditBundle: this.buildAuditBundle(dto, result, agentJobId, 'http'),
      };
    }

    const execution = await this.runKubernetesJob(dto, agentJobId);
    const result = this.aiService.normalizePlanningEvaluationSandboxResult(
      dto,
      execution.raw,
    );
    return {
      result,
      auditBundle: this.buildAuditBundle(
        dto,
        result,
        agentJobId,
        'kubernetes',
        execution.logs,
        execution.audit,
      ),
    };
  }

  private async runKubernetesJob(
    dto: EvaluatePlanningSubmissionDto,
    agentJobId: string,
  ): Promise<{
    raw: Record<string, unknown>;
    logs: string;
    audit: Record<string, unknown>;
  }> {
    const namespace = await this.namespace();
    const jobName = `planning-eval-${agentJobId.replaceAll('-', '').slice(0, 20)}-${randomUUID().slice(0, 8)}`;
    const encoded = Buffer.from(JSON.stringify(dto)).toString('base64');
    const maxInputBytes = Number(
      this.config.get<string>('EVALUATION_SANDBOX_MAX_INPUT_BYTES') ?? 600_000,
    );
    if (Buffer.byteLength(encoded) > maxInputBytes) {
      throw new ServiceUnavailableException(
        'Planning evaluation context is too large for the sandbox contract',
      );
    }

    const image = await this.resolveAiImage(namespace);
    await this.kubeRequest(
      'POST',
      `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`,
      this.jobManifest(namespace, jobName, image, encoded),
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
          `Could not clean evaluation sandbox ${jobName}: ${this.errorMessage(error)}`,
        ),
      );
    }
  }

  private jobManifest(
    namespace: string,
    jobName: string,
    image: string,
    encodedRequest: string,
  ) {
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace,
        labels: { app: 'planning-evaluation-sandbox' },
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: 300,
        ttlSecondsAfterFinished: 300,
        template: {
          metadata: {
            labels: {
              app: 'planning-evaluation-sandbox',
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
            containers: [
              {
                name: 'evaluator',
                image,
                imagePullPolicy: 'IfNotPresent',
                command: ['python', '-m', 'app.runners.planning_evaluation'],
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
                    name: 'FIGMA_ACCESS_TOKEN',
                    valueFrom: {
                      secretKeyRef: {
                        name: 'nexus-secret',
                        key: 'FIGMA_ACCESS_TOKEN',
                        optional: true,
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
                  requests: { cpu: '500m', memory: '512Mi' },
                  limits: { cpu: '2', memory: '2Gi' },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: { drop: ['ALL'] },
                },
                volumeMounts: [
                  { name: 'scratch', mountPath: '/tmp' },
                  { name: 'output', mountPath: '/workspace/output' },
                ],
              },
            ],
            volumes: [
              {
                name: 'scratch',
                emptyDir: { medium: 'Memory', sizeLimit: '192Mi' },
              },
              {
                name: 'output',
                emptyDir: { medium: 'Memory', sizeLimit: '8Mi' },
              },
            ],
          },
        },
      },
    };
  }

  private async waitForResult(
    namespace: string,
    jobName: string,
  ): Promise<{
    raw: Record<string, unknown>;
    logs: string;
    audit: Record<string, unknown>;
  }> {
    const timeoutMs = Number(
      this.config.get<string>('EVALUATION_SANDBOX_TIMEOUT_MS') ?? 300_000,
    );
    const deadline = Date.now() + timeoutMs;
    const jobPath = `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(jobName)}`;

    while (Date.now() < deadline) {
      const job = await this.kubeRequest('GET', jobPath);
      const status = this.asRecord(job.status);
      if (Number(status.succeeded ?? 0) > 0) {
        const logs = await this.podLogs(namespace, jobName);
        return {
          raw: this.parseResult(logs),
          logs,
          audit: this.parseAudit(logs),
        };
      }
      if (Number(status.failed ?? 0) > 0) {
        const logs = await this.podLogs(namespace, jobName).catch(() => '');
        throw new ServiceUnavailableException(
          `Planning evaluation sandbox failed${logs ? `: ${logs.slice(-1000)}` : ''}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new ServiceUnavailableException(
      'Planning evaluation sandbox timed out',
    );
  }

  private async podLogs(namespace: string, jobName: string) {
    const selector = encodeURIComponent(`job-name=${jobName}`);
    const pods = await this.kubeRequest(
      'GET',
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${selector}`,
    );
    const items = Array.isArray(pods.items) ? pods.items : [];
    const pod = this.asRecord(items[0]);
    const metadata = this.asRecord(pod.metadata);
    const name = typeof metadata.name === 'string' ? metadata.name : null;
    if (!name) throw new Error('Evaluation sandbox pod was not found');
    return this.kubeRequest(
      'GET',
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log`,
      undefined,
      true,
    );
  }

  private parseResult(logs: string): Record<string, unknown> {
    const line = logs
      .split(/\r?\n/)
      .reverse()
      .find((candidate) => candidate.startsWith(RESULT_MARKER));
    if (!line) {
      throw new ServiceUnavailableException(
        'Evaluation sandbox completed without a structured result payload',
      );
    }
    try {
      const decoded = Buffer.from(
        line.slice(RESULT_MARKER.length),
        'base64',
      ).toString('utf8');
      const result: unknown = JSON.parse(decoded);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('Result is not an object');
      }
      return result as Record<string, unknown>;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Evaluation sandbox returned an invalid result: ${this.errorMessage(error)}`,
      );
    }
  }

  private parseAudit(logs: string): Record<string, unknown> {
    const line = logs
      .split(/\r?\n/)
      .reverse()
      .find((candidate) => candidate.startsWith(AUDIT_MARKER));
    if (!line) return {};
    try {
      const value: unknown = JSON.parse(
        Buffer.from(line.slice(AUDIT_MARKER.length), 'base64').toString(
          'utf8',
        ),
      );
      return this.asRecord(value);
    } catch {
      return {};
    }
  }

  private buildAuditBundle(
    dto: EvaluatePlanningSubmissionDto,
    result: PlanningEvaluationResult,
    agentJobId: string,
    executionMode: 'http' | 'kubernetes',
    logs = '',
    runnerAudit: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const serializedVerdict = this.canonicalJson(result);
    const artifactManifest = result.artifactManifest ?? {};
    const artifactManifestHash =
      result.artifactManifestHash ||
      this.hash(this.canonicalJson(artifactManifest));
    const evaluationInputHash =
      result.evaluationInputHash || this.hash(this.canonicalJson(dto));
    const contextHash =
      result.contextHash ||
      this.hash(
        this.canonicalJson({
          project: dto.project,
          brief: dto.brief,
          requirements: dto.requirements,
          approvedArchitecture: dto.approvedArchitecture,
        }),
      );
    const sanitizedLogs = this.sanitizeLogs(logs);
    const summaryMarkdown =
      typeof runnerAudit.summaryMarkdown === 'string'
        ? runnerAudit.summaryMarkdown
        : this.summaryMarkdown(result);
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      executionMode,
      agentJobId,
      submissionId: dto.submission.submissionId,
      submissionVersion: dto.submission.submissionVersion,
      summaryMarkdown,
      verdict: result,
      verdictSha256: this.hash(serializedVerdict),
      artifactManifest,
      artifactManifestHash,
      evaluationInputHash,
      contextHash,
      promptVersion: result.promptVersion,
      modelName: result.modelName,
      runnerVerdictSha256:
        typeof runnerAudit.verdictSha256 === 'string'
          ? runnerAudit.verdictSha256
          : null,
      sandboxLog: logs
        ? {
            sha256: this.hash(logs),
            excerpt: sanitizedLogs.value,
            truncated: sanitizedLogs.truncated,
            redacted: sanitizedLogs.redacted,
          }
        : null,
    };
  }

  private summaryMarkdown(result: PlanningEvaluationResult) {
    const issues = result.openIssues?.length
      ? result.openIssues
          .map((issue) => `- [${issue.criterionKey}] ${issue.message}`)
          .join('\n')
      : '- None';
    return `# Planning evaluation\n\n- Recommendation: ${result.recommendation}\n- Score: ${result.score}\n- Input hash: ${result.evaluationInputHash}\n\n${result.summary}\n\n## Open issues\n${issues}\n`;
  }

  private sanitizeLogs(logs: string) {
    let value = logs
      .replace(
        new RegExp(`(${RESULT_MARKER}|${AUDIT_MARKER})[^\\r\\n]+`, 'g'),
        '$1[redacted structured payload]',
      )
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
      .replace(
        /(api[_-]?key|token|secret)(\s*[=:]\s*)[^\s,;]+/gi,
        '$1$2[redacted]',
      );
    const redacted = value !== logs;
    const truncated = value.length > 20_000;
    if (truncated) value = value.slice(-20_000);
    return { value, truncated, redacted };
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
      .map(
        (key) =>
          `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`,
      )
      .join(',')}}`;
  }

  private async resolveAiImage(namespace: string) {
    const configured = this.config.get<string>('EVALUATION_SANDBOX_IMAGE');
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
        'Could not resolve the deployed AI sandbox image',
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
            if (size > 5 * 1024 * 1024) {
              response.destroy(new Error('Kubernetes response exceeded 5MB'));
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
              const parsed: unknown = text ? JSON.parse(text) : {};
              resolve(this.asRecord(parsed));
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

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
