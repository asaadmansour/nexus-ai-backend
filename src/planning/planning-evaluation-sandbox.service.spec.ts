import { ConfigService } from '@nestjs/config';
import { AiService } from 'src/agents/ai.service';
import type { EvaluatePlanningSubmissionDto } from 'src/agents/dto/EvaluatePlanningSubmissionDto';
import { PlanningEvaluationSandboxService } from './planning-evaluation-sandbox.service';

const dto: EvaluatePlanningSubmissionDto = {
  project: { id: 'project' },
  brief: {},
  requirements: [
    {
      key: 'diagram',
      title: 'Architecture diagram',
      description: 'Provide a diagram',
      mandatory: true,
      requiresUrl: true,
    },
  ],
  submission: {
    submissionId: 'submission',
    submissionVersion: 1,
    submissionType: 'architecture',
    title: 'Architecture',
    summary: 'Summary',
    content: {
      requirementEvidence: {
        diagram: {
          summary: 'A diagram exists',
          urls: ['https://example.com/diagram.pdf'],
        },
      },
    },
    fileUrls: {},
  },
};

describe('Planning evaluation sandbox', () => {
  function createService() {
    return new PlanningEvaluationSandboxService(
      { get: jest.fn().mockReturnValue('http') } as unknown as ConfigService,
      {
        evaluatePlanningSubmission: jest.fn(),
      } as unknown as AiService,
    );
  }

  it('delegates to the HTTP AI service outside Kubernetes mode', async () => {
    const expected = { recommendation: 'changes_requested' };
    const ai = {
      evaluatePlanningSubmission: jest.fn().mockResolvedValue(expected),
    };
    const config = { get: jest.fn().mockReturnValue('http') };
    const service = new PlanningEvaluationSandboxService(
      config as unknown as ConfigService,
      ai as unknown as AiService,
    );

    await expect(service.evaluate(dto, 'job')).resolves.toBe(expected);
    expect(ai.evaluatePlanningSubmission).toHaveBeenCalledWith(dto);
  });

  it('builds a non-root, read-only job without backend credentials', () => {
    const service = createService() as unknown as {
      jobManifest: (
        namespace: string,
        name: string,
        image: string,
        input: string,
      ) => {
        spec: {
          template: {
            spec: {
              automountServiceAccountToken: boolean;
              securityContext: { runAsNonRoot: boolean };
              containers: Array<{
                env: Array<{ name: string }>;
                securityContext: {
                  readOnlyRootFilesystem: boolean;
                  capabilities: { drop: string[] };
                };
              }>;
            };
          };
        };
      };
    };
    const manifest = service.jobManifest(
      'default',
      'planning-eval-job',
      'ai:sha',
      'payload',
    );
    const pod = manifest.spec.template.spec;
    const container = pod.containers[0];

    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.securityContext.runAsNonRoot).toBe(true);
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(container.securityContext.capabilities.drop).toEqual(['ALL']);
    expect(container.env.map((item: { name: string }) => item.name)).toEqual([
      'HOME',
      'EVALUATION_REQUEST_B64',
      'GEMINI_API_KEY',
      'FIGMA_ACCESS_TOKEN',
      'GEMINI_MODEL',
    ]);
  });

  it('accepts only the structured result marker from sandbox logs', () => {
    const service = createService() as unknown as {
      parseResult: (logs: string) => Record<string, unknown>;
    };
    const encoded = Buffer.from(JSON.stringify({ score: 88 })).toString(
      'base64',
    );

    expect(
      service.parseResult(
        `untrusted output\nNEXUS_EVALUATION_RESULT:${encoded}\n`,
      ),
    ).toEqual({ score: 88 });
    expect(() => service.parseResult('{"score":100}')).toThrow(
      'without a structured result',
    );
  });

  it('does not trust a passing claim without an inspected artifact citation', () => {
    const service = new AiService({
      get: jest.fn(),
    } as unknown as ConfigService);
    const result = service.normalizePlanningEvaluationSandboxResult(dto, {
      score: 99,
      recommendation: 'approve',
      checks: [
        {
          key: 'diagram',
          status: 'met',
          severity: 'info',
          citations: [],
        },
      ],
      artifactManifest: {
        artifacts: [
          {
            id: 'artifact-1',
            status: 'inspected',
            requirementKeys: ['diagram'],
          },
        ],
      },
    });

    expect(result.recommendation).toBe('changes_requested');
    expect(result.checks[0].status).toBe('partial');
    expect(result.checks[0].severity).toBe('blocker');
    expect(result.score).toBe(69);
  });

  it('rejects citations from an artifact mapped to another requirement', () => {
    const service = new AiService({
      get: jest.fn(),
    } as unknown as ConfigService);
    const result = service.normalizePlanningEvaluationSandboxResult(dto, {
      score: 99,
      recommendation: 'approve',
      checks: [
        {
          key: 'diagram',
          status: 'met',
          severity: 'info',
          citations: [
            {
              artifactId: 'artifact-1',
              location: 'page 1',
              finding: 'A different contract',
            },
          ],
        },
      ],
      artifactManifest: {
        artifacts: [
          {
            id: 'artifact-1',
            status: 'inspected',
            requirementKeys: ['data_model'],
          },
        ],
      },
    });

    expect(result.recommendation).toBe('changes_requested');
    expect(result.checks[0].status).toBe('missing');
    expect(result.checks[0].citations).toEqual([]);
  });
});
