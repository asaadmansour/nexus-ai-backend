import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Brief } from 'src/projects/entities/brief.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectPlanningSubmission } from 'src/projects/entities/project-planning-submission.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { AiJobsProducer } from 'src/queues/ai-jobs.producer';
import { PlanningEvaluationSandboxService } from './planning-evaluation-sandbox.service';
import { PlanningEvaluationsService } from './planning-evaluations.service';

describe('PlanningEvaluationsService verdict history', () => {
  it('preserves the prior verdict when queueing fails and is retried again', async () => {
    const priorVerdict = {
      recommendation: 'changes_requested',
      evaluationInputHash: 'stable-input',
      openIssues: [{ id: 'issue-1', criterionKey: 'system_context' }],
    };
    const submission = {
      id: 'submission-id',
      projectId: 'project-id',
      submissionType: 'architecture',
      status: 'submitted',
      evaluationStatus: 'completed',
      evaluationResult: priorVerdict,
      evaluationAuditBundle: { verdictSha256: 'old-verdict-hash' },
    } as unknown as ProjectPlanningSubmission;
    const submissionRepo = {
      findOne: jest.fn().mockResolvedValue(submission),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<ProjectPlanningSubmission>;
    const producer = {
      emitPlanningSubmissionEvaluationRequested: jest
        .fn()
        .mockRejectedValueOnce(new Error('queue unavailable'))
        .mockResolvedValueOnce({ id: 'agent-job-id' }),
    } as unknown as AiJobsProducer;
    const emptyRepo = {} as Repository<never>;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test'),
    } as unknown as ConfigService;
    const service = new PlanningEvaluationsService(
      submissionRepo,
      emptyRepo as Repository<Project>,
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<Brief>,
      emptyRepo as Repository<AgentJob>,
      emptyRepo as Repository<FreelancerProfile>,
      emptyRepo as Repository<ProjectRoleAssignment>,
      {} as PlanningEvaluationSandboxService,
      producer,
      {} as NotificationsService,
      config,
    );

    await expect(
      service.queueSubmissionEvaluation(submission.id),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(submission.evaluationResult).toBeNull();

    await expect(
      service.queueSubmissionEvaluation(submission.id),
    ).resolves.toMatchObject({ status: 'queued' });
    expect(submission.evaluationRequirements).toMatchObject({
      previousVerdict: priorVerdict,
      previousAuditBundle: { verdictSha256: 'old-verdict-hash' },
    });
  });
});
