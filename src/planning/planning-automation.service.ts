import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ProjectPlansService } from './project-plans.service';
import { AutomationIncidentsService } from 'src/automation/automation-incidents.service';

@Injectable()
export class PlanningAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PlanningAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly plans: ProjectPlansService,
    private readonly incidents: AutomationIncidentsService,
  ) {}

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
          `Could not recover planning automation for project ${failure.projectId}: ${failure.error}`,
        );
        await this.incidents.record({
          subsystem: 'planning',
          operation: 'recover',
          projectId: failure.projectId,
          errorCode: 'recovery_failed',
          message: failure.error,
          context: 'planId' in failure ? { planId: failure.planId } : undefined,
        });
      }
      for (const projectId of [
        ...generation.queuedProjectIds,
        ...materialization.recoveredProjectIds,
      ]) {
        await this.incidents.resolveOperation('planning', 'recover', projectId);
      }
      await this.incidents.resolveOperation('planning', 'scan');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Planning automation scan failed: ${message}`);
      await this.incidents.record({
        subsystem: 'planning',
        operation: 'scan',
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
