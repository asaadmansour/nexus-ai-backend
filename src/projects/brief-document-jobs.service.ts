import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOBS, QUEUES } from 'src/queues/queue.constants';
import { RequirementsDocumentProcessingJobData } from 'src/queues/queue.types';

@Injectable()
export class BriefDocumentJobsService {
  constructor(
    @Optional()
    @InjectQueue(QUEUES.REQUIREMENTS_DOCUMENT_PROCESSING)
    private readonly queue: Queue<RequirementsDocumentProcessingJobData> | null,
  ) {}

  enabled() {
    return this.queue != null;
  }

  async enqueue(documentId: string) {
    if (!this.queue) return false;
    const jobId = `requirements-document-${documentId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') {
        await existing.remove();
      } else {
        // Waiting, delayed and active jobs already own this document. Treat the
        // deterministic duplicate as success instead of creating parallel work.
        return true;
      }
    }
    await this.queue.add(
      JOBS.PROCESS_REQUIREMENTS_DOCUMENT,
      { documentId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 5_000,
      },
    );
    return true;
  }
}
