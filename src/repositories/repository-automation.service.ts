import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { RepositoriesService } from './repositories.service';

@Injectable()
export class RepositoryAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RepositoryAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly repositories: RepositoriesService) {}

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
    } catch (error) {
      this.logger.error(
        `Repository automation scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
