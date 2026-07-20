import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_JOB_RETRY, JOBS, QUEUES } from 'src/queues/queue.constants';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import { ProfileEmbeddingJobData } from 'src/queues/queue.types';
import { FreelancerAiJobsService } from '../freelancer-ai-jobs.service';

@Processor(QUEUES.PROFILE_EMBEDDING, { concurrency: 2 })
export class ProfileEmbeddingProcessor extends SafeWorkerHost {
  constructor(private readonly freelancerAiJobs: FreelancerAiJobsService) {
    super();
  }

  async process(job: Job<ProfileEmbeddingJobData>) {
    if (job.name !== JOBS.GENERATE_PROFILE_EMBEDDING) return;
    return this.freelancerAiJobs.processProfileEmbedding(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? AI_JOB_RETRY.ATTEMPTS,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(QUEUES.PROFILE_EMBEDDING, error);
  }
}
