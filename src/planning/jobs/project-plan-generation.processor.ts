import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AI_JOB_RETRY, JOBS, QUEUES } from 'src/queues/queue.constants';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import { ProjectPlanGenerationJobData } from 'src/queues/queue.types';
import { ProjectPlansService } from '../project-plans.service';

@Processor(QUEUES.PROJECT_PLAN_GENERATION, { concurrency: 1 })
export class ProjectPlanGenerationProcessor extends SafeWorkerHost {
  constructor(private readonly projectPlans: ProjectPlansService) {
    super();
  }

  async process(job: Job<ProjectPlanGenerationJobData>) {
    if (job.name !== JOBS.GENERATE_PROJECT_PLAN) return;
    return this.projectPlans.processQueuedGeneration(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? AI_JOB_RETRY.ATTEMPTS,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(QUEUES.PROJECT_PLAN_GENERATION, error);
  }
}
