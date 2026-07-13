import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { JOBS, QUEUES } from 'src/queues/queue.constants';
import { CvExtractionJobData } from 'src/queues/queue.types';
import { FreelancerAiJobsService } from '../freelancer-ai-jobs.service';

@Processor(QUEUES.CV_EXTRACTION, { concurrency: 2 })
export class CvExtractionProcessor extends WorkerHost {
  constructor(private readonly freelancerAiJobs: FreelancerAiJobsService) {
    super();
  }

  async process(job: Job<CvExtractionJobData>) {
    if (job.name !== JOBS.EXTRACT_CV) return;
    return this.freelancerAiJobs.processCvExtraction(
      job.data,
      job.attemptsMade,
    );
  }
}
