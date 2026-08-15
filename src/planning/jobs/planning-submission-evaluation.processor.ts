import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_JOB_RETRY, JOBS, QUEUES } from 'src/queues/queue.constants';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import type { PlanningSubmissionEvaluationJobData } from 'src/queues/queue.types';
import { PlanningEvaluationsService } from '../planning-evaluations.service';

@Processor(QUEUES.PLANNING_SUBMISSION_EVALUATION, { concurrency: 1 })
export class PlanningSubmissionEvaluationProcessor extends SafeWorkerHost {
  constructor(private readonly evaluations: PlanningEvaluationsService) {
    super();
  }

  async process(job: Job<PlanningSubmissionEvaluationJobData>) {
    if (job.name !== JOBS.EVALUATE_PLANNING_SUBMISSION) return;
    return this.evaluations.processPlanningSubmissionEvaluation(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? AI_JOB_RETRY.ATTEMPTS,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(QUEUES.PLANNING_SUBMISSION_EVALUATION, error);
  }
}
