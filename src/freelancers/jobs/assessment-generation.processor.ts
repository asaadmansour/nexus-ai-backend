import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { JOBS, QUEUES } from 'src/queues/queue.constants';
import { AssessmentGenerationJobData } from 'src/queues/queue.types';
import { FreelancerAiJobsService } from '../freelancer-ai-jobs.service';

@Processor(QUEUES.ASSESSMENT_GENERATION, { concurrency: 1 })
export class AssessmentGenerationProcessor extends WorkerHost {
  constructor(private readonly freelancerAiJobs: FreelancerAiJobsService) {
    super();
  }

  async process(job: Job<AssessmentGenerationJobData>) {
    if (job.name !== JOBS.GENERATE_ASSESSMENT) return;
    return this.freelancerAiJobs.processAssessmentGeneration(
      job.data,
      job.attemptsMade,
    );
  }
}
