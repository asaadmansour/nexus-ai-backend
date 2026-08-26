import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { RepositoriesService } from './repositories.service';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';

@Injectable()
export class RepositoryAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RepositoryAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repositories: RepositoriesService,
    private readonly incidents: AutomationIncidentsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile(), 5 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.reconcile(), 20_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      await this.repositories.reconcileAutomation();
      await this.incidents.resolveOperation('repositories', 'reconcile');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Repository automation scan failed: ${message}`);
      await this.incidents.record({
        subsystem: 'repositories',
        operation: 'reconcile',
        errorCode: 'scan_failed',
        severity: 'critical',
        message,
      });
    } finally {
      this.running = false;
    }
  }
}
