import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { AiJobsProducer } from './ai-jobs.producer';
import { SubmissionEvaluationJobData } from './queue.types';

describe('AiJobsProducer', () => {
  it('links evaluation jobs to delivery submissions, not planning submissions', async () => {
    const queue = {
      add: jest.fn().mockResolvedValue(undefined),
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

    await producer.emitSubmissionEvaluationRequested({
      evaluationRunId: 'evaluation-run-id',
      submissionId: 'delivery-submission-id',
      projectId: 'project-id',
      taskId: 'task-id',
    });

    expect(createAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSubmissionId: 'delivery-submission-id',
        taskId: 'task-id',
      }),
    );
    expect(createAgentJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'delivery-submission-id' }),
    );
  });
});
