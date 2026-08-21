import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ProjectPlansService } from './project-plans.service';

@Injectable()
export class PlanningAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PlanningAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly plans: ProjectPlansService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.reconcile(), 15_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const generation = await this.plans.recoverMissingPlanGenerations();
      const materialization =
        await this.plans.recoverApprovedUnmaterializedPlans();
      for (const failure of [
        ...generation.failures,
        ...materialization.failures,
      ]) {
        this.logger.error(
          `Could not recover planning automation for ${'planId' in failure ? failure.planId : failure.projectId}: ${failure.error}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Planning automation scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
