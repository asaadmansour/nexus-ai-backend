import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { MatchingService } from './matching.service';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';

@Injectable()
export class MatchingAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MatchingAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly matchingService: MatchingService,
    private readonly incidents: AutomationIncidentsService,
  ) {}

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
      await this.matchingService.recoverProjectsAwaitingPrincipalReviewer();
      await this.matchingService.recoverAcceptingInvitations();
      await this.matchingService.recoverUndeliveredInvitationNotifications();
      await this.matchingService.expirePendingInvitations();
      await this.matchingService.recoverRunsMissingFallbackInvitations();
      await this.matchingService.recoverPlanningRolesAfterReviewerAcceptance();
      await this.matchingService.recoverPlanningFundingReadiness();
      await this.matchingService.refreshUnavailableImplementationCapacity();
      await this.matchingService.recoverImplementationFundingReadyNotifications();
      await this.matchingService.recoverFundedStageActivations();
      await this.matchingService.recoverReadyForFundingNotifications();
      await this.matchingService.recoverBlockedStaffing();
      await this.matchingService.recoverImplementationTasksWithoutMatchingRuns();
      await this.incidents.resolveOperation('matching', 'reconcile');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Invitation reconciliation failed: ${message}`);
      await this.incidents.record({
        subsystem: 'matching',
        operation: 'reconcile',
        errorCode: 'scan_failed',
        severity: 'critical',
        message,
        trace: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      this.running = false;
    }
  }
}
