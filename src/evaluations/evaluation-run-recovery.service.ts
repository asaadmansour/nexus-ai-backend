import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';

const STARTUP_DELAY_MS = 10_000;
const SCAN_INTERVAL_MS = 60_000;

@Injectable()
export class EvaluationRunRecoveryService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(EvaluationRunRecoveryService.name);
  private startupTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(private readonly evaluations: EvaluationsService) {}

  onModuleInit() {
    this.startupTimer = setTimeout(() => {
      void this.reconcile();
    }, STARTUP_DELAY_MS);
    this.startupTimer.unref();

    this.scanTimer = setInterval(() => {
      void this.reconcile();
    }, SCAN_INTERVAL_MS);
    this.scanTimer.unref();
  }

  onApplicationShutdown() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  async reconcile() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const result = await this.evaluations.recoverOrphanedRuns();
      if (result.recovered > 0) {
        this.logger.warn(
          `Recovered ${result.recovered} orphaned evaluation dispatches`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Evaluation-run recovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.scanning = false;
    }
  }
}
