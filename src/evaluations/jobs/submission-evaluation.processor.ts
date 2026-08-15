import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_JOB_RETRY, JOBS, QUEUES } from 'src/queues/queue.constants';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import type { SubmissionEvaluationJobData } from 'src/queues/queue.types';
import { EvaluationsService } from '../evaluations.service';

@Processor(QUEUES.SUBMISSION_EVALUATION, { concurrency: 1 })
export class SubmissionEvaluationProcessor extends SafeWorkerHost {
  constructor(private readonly evaluations: EvaluationsService) {
    super();
  }

  async process(job: Job<SubmissionEvaluationJobData>) {
    if (job.name !== JOBS.EVALUATE_SUBMISSION) return;
    return this.evaluations.processSubmissionEvaluation(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? AI_JOB_RETRY.ATTEMPTS,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(QUEUES.SUBMISSION_EVALUATION, error);
  }
}
