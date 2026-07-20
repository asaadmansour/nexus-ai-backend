import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_JOB_RETRY, JOBS, QUEUES } from 'src/queues/queue.constants';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import { CvExtractionJobData } from 'src/queues/queue.types';
import { FreelancerAiJobsService } from '../freelancer-ai-jobs.service';

@Processor(QUEUES.CV_EXTRACTION, { concurrency: 2 })
export class CvExtractionProcessor extends SafeWorkerHost {
  constructor(private readonly freelancerAiJobs: FreelancerAiJobsService) {
    super();
  }

  async process(job: Job<CvExtractionJobData>) {
    if (job.name !== JOBS.EXTRACT_CV) return;
    return this.freelancerAiJobs.processCvExtraction(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? AI_JOB_RETRY.ATTEMPTS,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(QUEUES.CV_EXTRACTION, error);
  }
}
