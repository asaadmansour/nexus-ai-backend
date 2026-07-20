import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import {
  formatRedisError,
  isNonRecoverableRedisError,
} from 'src/redis/redis-options';

const QUEUE_ERROR_LOG_INTERVAL_MS = 30000;

export abstract class SafeWorkerHost extends WorkerHost {
  private readonly queueLogger = new Logger(this.constructor.name);
  private lastQueueErrorLogAt = 0;

  protected async handleWorkerError(queueName: string, error: Error) {
    const now = Date.now();
    if (now - this.lastQueueErrorLogAt >= QUEUE_ERROR_LOG_INTERVAL_MS) {
      this.lastQueueErrorLogAt = now;
      this.queueLogger.warn(
        `Queue ${queueName} unavailable: ${formatRedisError(error)}`,
      );
    }

    if (isNonRecoverableRedisError(error)) {
      await this.worker.close().catch(() => undefined);
    }
  }
}
