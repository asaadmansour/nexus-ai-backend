import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { AI_JOB_TYPES } from './queue.constants';
import { AiJobsProducer } from './ai-jobs.producer';
import {
  ProjectPlanGenerationJobData,
  SubmissionEvaluationJobData,
} from './queue.types';

describe('AiJobsProducer', () => {
  it('reuses the durable logical job when the same AI request is emitted twice', async () => {
    const existing = {
      id: 'existing-job-id',
      status: 'completed',
    } as AgentJob;
    const createdInputs: Partial<AgentJob>[] = [];
    const findOneJob = jest.fn().mockResolvedValue(existing);
    const repository = {
      create: jest.fn((input: Partial<AgentJob>) => {
        createdInputs.push(input);
        return input;
      }),
      save: jest.fn().mockRejectedValue({ code: '23505' }),
      findOne: findOneJob,
    } as unknown as Repository<AgentJob>;
    const producer = new AiJobsProducer(
      null,
      null,
      null,
      null,
      null,
      null,
      repository,
    );

    await expect(
      producer.emitCvUploaded({
        userId: 'user-id',
        profileId: 'profile-id',
        cvUrl: 'https://files.example/cv.pdf',
      }),
    ).resolves.toBe(existing);
    expect(findOneJob).toHaveBeenCalledTimes(1);
    expect(createdInputs[0].idempotencyKey).toMatch(/^cv_extraction:/);
  });

  it('links evaluation jobs to delivery submissions, not planning submissions', async () => {
    const addJob = jest.fn().mockResolvedValue(undefined);
    const queue = {
      add: addJob,
    } as unknown as Queue<SubmissionEvaluationJobData>;
    const agentJob = { id: 'agent-job-id' } as AgentJob;
    const createAgentJob = jest.fn((input: Partial<AgentJob>) =>
      Object.assign(agentJob, input),
    );
    const repository = {
      create: createAgentJob,
      save: jest.fn((job: AgentJob) => Promise.resolve(job)),
    } as unknown as Repository<AgentJob>;
    const producer = new AiJobsProducer(
      null,
      null,
      null,
      null,
      null,
      queue,
      repository,
    );

    const prepared = await producer.prepareSubmissionEvaluationRequested({
      evaluationRunId: 'evaluation-run-id',
      submissionId: 'delivery-submission-id',
      projectId: 'project-id',
      taskId: 'task-id',
    });
    await producer.dispatchPreparedSubmissionEvaluation(prepared);

    expect(createAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSubmissionId: 'delivery-submission-id',
        taskId: 'task-id',
      }),
    );
    expect(createAgentJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'delivery-submission-id' }),
    );
    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        agentJobId: agentJob.id,
        evaluationRunId: 'evaluation-run-id',
        submissionId: 'delivery-submission-id',
      }),
      expect.objectContaining({ jobId: agentJob.id }),
    );
  });

  it('recreates an orphaned project-plan queue dispatch from saved input', async () => {
    const addJob = jest.fn().mockResolvedValue(undefined);
    const queue = {
      getJob: jest.fn().mockResolvedValue(null),
      add: addJob,
    } as unknown as Queue<ProjectPlanGenerationJobData>;
    const agentJob = {
      id: 'plan-agent-job-id',
      jobType: AI_JOB_TYPES.PROJECT_PLAN_GENERATION,
      status: 'queued',
      queueJobId: 'missing-queue-job-id',
      attempts: 1,
      error: null,
      output: null,
      input: {
        projectId: 'project-id',
        architectureSubmissionId: 'architecture-id',
        uiuxSubmissionId: 'uiux-id',
        requestedBy: 'reviewer-id',
        notes: 'Generate the approved planning handoff.',
      },
    } as AgentJob;
    const saveAgentJob = jest.fn((job: AgentJob) => Promise.resolve(job));
    const repository = {
      save: saveAgentJob,
    } as unknown as Repository<AgentJob>;
    const producer = new AiJobsProducer(
      null,
      null,
      null,
      queue,
      null,
      null,
      repository,
    );

    const result = await producer.ensureProjectPlanGenerationDispatch(agentJob);

    expect(result).toMatchObject({ recovered: true, state: 'waiting' });
    expect(addJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        agentJobId: agentJob.id,
        projectId: 'project-id',
        architectureSubmissionId: 'architecture-id',
        uiuxSubmissionId: 'uiux-id',
      }),
      expect.objectContaining({ jobId: 'plan-agent-job-id-dispatch-1' }),
    );
    expect(saveAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        queueJobId: 'plan-agent-job-id-dispatch-1',
        attempts: 0,
      }),
    );
  });
});
