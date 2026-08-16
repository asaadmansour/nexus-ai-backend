import type { EvaluateSubmissionDto } from 'src/agents/dto/EvaluateSubmissionDto';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { EvaluationRun } from 'src/projects/entities/evaluation-run.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import type { EvaluateSubmissionResult } from 'src/agents/ai.service';
import { EvaluationsService } from './evaluations.service';

type TaskPayloadBuilder = {
  buildTaskPayload(
    task: ProjectTask | null,
    submission: ProjectSubmission,
    submissionType: string,
  ): EvaluateSubmissionDto['task'];
};

describe('EvaluationsService implementation rubric payload', () => {
  const service = Object.create(
    EvaluationsService.prototype,
  ) as EvaluationsService;
  const buildTaskPayload = (
    task: ProjectTask | null,
    submission: ProjectSubmission,
    submissionType: string,
  ) =>
    (service as unknown as TaskPayloadBuilder).buildTaskPayload(
      task,
      submission,
      submissionType,
    );
  const submission = {
    id: 'submission-id',
    taskId: 'task-id',
    title: 'Delivery',
    summary: 'Summary',
  } as ProjectSubmission;
  const task = {
    id: 'task-id',
    title: 'Implement orders endpoint',
    description: 'Create the endpoint',
    acceptanceCriteria: ['Endpoint returns 201'],
    metadata: {
      deliverables: ['Orders endpoint'],
      integrationChecks: ['Consumer contract tests pass'],
      contractReferences: ['API contract: POST /orders'],
      ownedPaths: ['src/orders/**'],
    },
  } as ProjectTask;

  it('includes task requirements, contracts, scope, and quality policy for a PR', () => {
    const payload = buildTaskPayload(task, submission, 'pull_request');

    expect(payload.acceptanceCriteria).toEqual(['Endpoint returns 201']);
    expect(payload.deliverables).toEqual(['Orders endpoint']);
    expect(payload.integrationChecks).toEqual(['Consumer contract tests pass']);
    expect(payload.contractReferences).toEqual(['API contract: POST /orders']);
    expect(payload.ownedPaths).toEqual(['src/orders/**']);
    expect(payload.evaluationProfile).toMatchObject({
      complexity: 'standard',
      requiresAutomatedTests: true,
      capabilities: { api: true },
    });
    expect(payload.evaluationCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'verification_automated_tests',
          mandatory: true,
          allowNotApplicable: false,
        }),
        expect.objectContaining({ key: 'contract_reference_1' }),
        expect.objectContaining({ key: 'scope_owned_paths' }),
      ]),
    );
  });

  it('uses proportionate verification for a trivial static change', () => {
    const payload = buildTaskPayload(
      {
        id: 'task-id',
        title: 'Render Hello World',
        description: 'Show the approved string on one static page.',
        acceptanceCriteria: ['The page displays Hello World'],
        metadata: { deliverables: ['One working page'] },
      } as ProjectTask,
      submission,
      'pull_request',
    );

    expect(payload.evaluationProfile).toMatchObject({
      complexity: 'trivial',
      requiresAutomatedTests: false,
      capabilities: {
        api: false,
        data: false,
        authenticationOrPrivacy: false,
        operationsOrMigration: false,
      },
    });
    expect(payload.evaluationCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'verification_proportionate' }),
      ]),
    );
    expect(payload.evaluationCriteria).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'verification_automated_tests' }),
        expect.objectContaining({ key: 'operations_readiness' }),
      ]),
    );
  });

  it('does not impose code-only quality rows on a text submission', () => {
    const payload = buildTaskPayload(task, submission, 'text');

    expect(payload.qualityCriteria).toEqual([]);
  });
});

describe('EvaluationsService GitHub update coalescing', () => {
  it('reuses an active sandbox run when another event targets the same commit', async () => {
    const commitSha = 'a'.repeat(40);
    const submission = {
      id: 'submission-id',
      status: 'under_review',
      commitSha,
      metadata: {},
    } as ProjectSubmission;
    const activeRun = {
      id: 'run-id',
      status: 'running',
      agentJobId: 'job-id',
    };
    const submissionQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(submission),
    };
    const submissionRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(submissionQuery),
      save: jest.fn().mockResolvedValue(submission),
    };
    const runRepo = {
      find: jest.fn().mockResolvedValue([activeRun]),
      save: jest.fn(),
    };
    const service = Object.create(
      EvaluationsService.prototype,
    ) as EvaluationsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      dataSource: {
        transaction: jest.fn(
          (callback: (manager: Record<string, unknown>) => unknown) =>
            callback({
              getRepository: (entity: unknown) =>
                entity === ProjectSubmission ? submissionRepo : runRepo,
            }),
        ),
      },
    });

    await expect(
      service.requeueForRepositoryUpdate({
        submissionId: submission.id,
        commitSha,
        reason: 'github_check_run_completed',
      }),
    ).resolves.toEqual({
      evaluationRunId: 'run-id',
      agentJobId: 'job-id',
      status: 'running',
      reused: true,
    });
    expect(runRepo.save).not.toHaveBeenCalled();
    expect(submissionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ commitSha }),
    );
  });
});

describe('EvaluationsService rubric snapshot consistency', () => {
  it('reuses the frozen rubric when a completed submission is evaluated again', async () => {
    const rubricSnapshot = {
      schemaVersion: 1,
      capturedAt: '2026-08-16T00:00:00.000Z',
      profile: {
        version: 1,
        complexity: 'trivial',
        requiresAutomatedTests: false,
        capabilities: {
          api: false,
          data: false,
          authenticationOrPrivacy: false,
          operationsOrMigration: false,
        },
        rationale: ['Frozen assignment rubric'],
      },
      criteria: [
        {
          key: 'verification_proportionate',
          criterion: 'Proportionate verification passes.',
          category: 'verification',
          mandatory: true,
          allowNotApplicable: false,
          rationale: 'Small static task',
        },
      ],
    };
    const submission = {
      id: 'submission-id',
      projectId: 'project-id',
      taskId: 'task-id',
      milestoneId: 'milestone-id',
      submissionType: 'pull_request',
    } as ProjectSubmission;
    const previousRun = {
      id: 'old-run',
      status: 'completed',
      acceptanceCoverage: { rubricSnapshot },
    } as EvaluationRun;
    const createdRun = {
      id: 'new-run',
      status: 'queued',
      agentJobId: null,
    } as EvaluationRun;
    const runRepo = {
      findOne: jest.fn().mockResolvedValue(previousRun),
      create: jest.fn((value: Record<string, unknown>) =>
        Object.assign(createdRun, value),
      ),
      save: jest.fn((value: EvaluationRun) => Promise.resolve(value)),
    };
    const service = Object.create(
      EvaluationsService.prototype,
    ) as EvaluationsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      submissionRepo: { findOne: jest.fn().mockResolvedValue(submission) },
      runRepo,
      aiJobsProducer: {
        emitSubmissionEvaluationRequested: jest
          .fn()
          .mockResolvedValue({ id: 'agent-job-id' }),
      },
      logger: { log: jest.fn() },
    });

    await service.queueForSubmission(
      submission.id,
      { mode: 'async', reason: 'github_followup' },
      'github-webhook',
    );

    expect(runRepo.create).toHaveBeenCalledTimes(1);
    const createInput = runRepo.create.mock.calls[0][0];
    const coverage = createInput.acceptanceCoverage as Record<string, unknown>;
    expect(createInput.promptVersion).toBe('submission-evaluation-v4-adaptive');
    expect(coverage.pending).toBe(1);
    expect(coverage.rubricSnapshot).toEqual(rubricSnapshot);
  });
});

describe('EvaluationsService revision verdict', () => {
  it('opens an actionable revision and unlocks the task after a failed verdict', async () => {
    const commitSha = 'a'.repeat(40);
    const submission = {
      id: 'submission-id',
      projectId: 'project-id',
      taskId: 'task-id',
      milestoneId: 'milestone-id',
      freelancerProfileId: 'freelancer-id',
      submissionType: 'pull_request',
      commitSha,
      status: 'under_review',
      title: 'Orders endpoint',
    } as ProjectSubmission;
    const submissionQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(submission),
    };
    const submissionRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(submissionQuery),
      save: jest.fn().mockResolvedValue(submission),
    };
    const taskRepo = { update: jest.fn().mockResolvedValue(undefined) };
    const revisionRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === ProjectSubmission) return submissionRepo;
        if (entity === ProjectTask) return taskRepo;
        if (entity === ProjectRevisionRequest) return revisionRepo;
        throw new Error('Unexpected repository');
      },
    };
    const service = Object.create(
      EvaluationsService.prototype,
    ) as EvaluationsService;
    Object.assign(service as unknown as Record<string, unknown>, {
      dataSource: {
        transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
          callback(manager),
        ),
      },
    });
    const result = {
      passed: false,
      score: 45,
      revisionRequested: true,
      revisionNotes: 'Fix the failing contract test.',
      requiresHumanReview: false,
      rubric: [
        {
          criterion: 'Contract test passes',
          status: 'unmet',
          met: false,
          evidence: 'Failed',
        },
      ],
      findings: ['The response shape changed.'],
      risks: ['The frontend contract will break.'],
      source: 'fastapi',
    } satisfies EvaluateSubmissionResult;

    await (
      service as unknown as {
        applyRevisionVerdict(
          value: ProjectSubmission,
          run: EvaluationRun,
          verdict: EvaluateSubmissionResult,
        ): Promise<void>;
      }
    ).applyRevisionVerdict(
      submission,
      {
        id: 'run-id',
        evaluatedCommitSha: commitSha,
      } as EvaluationRun,
      result,
    );

    expect(submission.status).toBe('changes_requested');
    expect(taskRepo.update).toHaveBeenCalledWith('task-id', {
      status: 'changes_requested',
    });
    expect(revisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: 'submission-id',
        assignedToFreelancerProfileId: 'freelancer-id',
        status: 'open',
      }),
    );
  });
});
