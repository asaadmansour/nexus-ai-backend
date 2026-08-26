import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { JOBS, QUEUES } from 'src/queues/queue.constants';
import { RequirementsDocumentProcessingJobData } from 'src/queues/queue.types';
import { SafeWorkerHost } from 'src/queues/safe-worker-host';
import { BriefService } from '../brief.service';

@Processor(QUEUES.REQUIREMENTS_DOCUMENT_PROCESSING, { concurrency: 2 })
export class BriefDocumentProcessingProcessor extends SafeWorkerHost {
  constructor(private readonly briefService: BriefService) {
    super();
  }

  async process(job: Job<RequirementsDocumentProcessingJobData>) {
    if (job.name !== JOBS.PROCESS_REQUIREMENTS_DOCUMENT) return;
    return this.briefService.processQueuedDocument(
      job.data.documentId,
      job.attemptsMade,
      job.opts.attempts ?? 3,
    );
  }

  @OnWorkerEvent('error')
  async onWorkerError(error: Error) {
    await this.handleWorkerError(
      QUEUES.REQUIREMENTS_DOCUMENT_PROCESSING,
      error,
    );
  }
}
