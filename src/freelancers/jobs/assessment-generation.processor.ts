import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_JOB_RETRY, JOBS, QUEUES } from 'src/queues/queue.constants';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import { AssessmentGenerationJobData } from 'src/queues/queue.types';
import { FreelancerAiJobsService } from '../freelancer-ai-jobs.service';

@Processor(QUEUES.ASSESSMENT_GENERATION, { concurrency: 1 })
export class AssessmentGenerationProcessor extends SafeWorkerHost {
  constructor(private readonly freelancerAiJobs: FreelancerAiJobsService) {
    super();
  }

  async process(job: Job<AssessmentGenerationJobData>) {
    if (job.name !== JOBS.GENERATE_ASSESSMENT) return;
    return this.freelancerAiJobs.processAssessmentGeneration(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? AI_JOB_RETRY.ATTEMPTS,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(QUEUES.ASSESSMENT_GENERATION, error);
  }
}
