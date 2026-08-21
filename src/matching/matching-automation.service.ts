import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { MatchingService } from './matching.service';

@Injectable()
export class MatchingAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MatchingAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly matchingService: MatchingService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.reconcile(), 5_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      await this.matchingService.recoverAcceptingInvitations();
      await this.matchingService.expirePendingInvitations();
      await this.matchingService.recoverPlanningRolesAfterReviewerAcceptance();
      await this.matchingService.recoverBlockedStaffing();
      await this.matchingService.recoverImplementationTasksWithoutMatchingRuns();
    } catch (error) {
      this.logger.error(
        `Invitation reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
