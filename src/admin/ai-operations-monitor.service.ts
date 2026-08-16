import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { User } from 'src/users/entities/user.entity';

export interface AiOperationsSnapshot {
  status: 'healthy' | 'degraded' | 'failing';
  stuckQueued: number;
  stuckRunning: number;
  failedRecent: number;
  checkedAt: string;
}

export function deriveAiOperationsStatus(
  stuckQueued: number,
  stuckRunning: number,
  failedRecent: number,
  failureThreshold: number,
): AiOperationsSnapshot['status'] {
  if (stuckRunning > 0 || failedRecent >= failureThreshold) return 'failing';
  if (stuckQueued > 0 || failedRecent > 0) return 'degraded';
  return 'healthy';
}

@Injectable()
export class AiOperationsMonitorService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AiOperationsMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private lastAlertSignature = '';
  private lastAlertAt = 0;

  constructor(
    @InjectRepository(AgentJob)
    private readonly jobs: Repository<AgentJob>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.enabled()) return;
    const interval = this.number('AI_JOB_MONITOR_INTERVAL_MS', 300_000, 60_000);
    this.timer = setInterval(() => void this.checkAndAlert(), interval);
    this.startupTimer = setTimeout(
      () => void this.checkAndAlert(),
      Math.min(30_000, interval),
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  async snapshot(): Promise<AiOperationsSnapshot> {
    const now = Date.now();
    const queuedBefore = new Date(
      now - this.number('AI_JOB_STUCK_QUEUED_MS', 900_000, 60_000),
    );
    const runningBefore = new Date(
      now - this.number('AI_JOB_STUCK_RUNNING_MS', 600_000, 60_000),
    );
    const failureSince = new Date(now - 15 * 60_000);
    const [stuckQueued, stuckRunning, failedRecent] = await Promise.all([
      this.jobs
        .createQueryBuilder('job')
        .where('job.status IN (:...statuses)', {
          statuses: ['queued', 'retrying'],
        })
        .andWhere('COALESCE(job.updatedAt, job.createdAt) < :queuedBefore', {
          queuedBefore,
        })
        .getCount(),
      this.jobs
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'running' })
        .andWhere('COALESCE(job.lockedAt, job.startedAt, job.updatedAt) < :runningBefore', {
          runningBefore,
        })
        .getCount(),
      this.jobs
        .createQueryBuilder('job')
        .where('job.status = :status', { status: 'failed' })
        .andWhere('job.failedAt >= :failureSince', { failureSince })
        .getCount(),
    ]);
    const threshold = this.number('AI_JOB_FAILURE_ALERT_THRESHOLD', 3, 1);
    const status = deriveAiOperationsStatus(
      stuckQueued,
      stuckRunning,
      failedRecent,
      threshold,
    );
    return {
      status,
      stuckQueued,
      stuckRunning,
      failedRecent,
      checkedAt: new Date().toISOString(),
    };
  }

  async checkAndAlert() {
    try {
      const snapshot = await this.snapshot();
      if (snapshot.status === 'healthy') {
        this.lastAlertSignature = '';
        return snapshot;
      }
      const signature = `${snapshot.status}:${snapshot.stuckQueued}:${snapshot.stuckRunning}:${snapshot.failedRecent}`;
      const cooldown = this.number('AI_JOB_ALERT_COOLDOWN_MS', 3_600_000, 60_000);
      if (
        signature === this.lastAlertSignature &&
        Date.now() - this.lastAlertAt < cooldown
      ) {
        return snapshot;
      }
      this.logger.error(
        `AI operations ${snapshot.status}: ${snapshot.stuckQueued} queued stuck, ${snapshot.stuckRunning} running stuck, ${snapshot.failedRecent} recent failures`,
      );
      const admins = await this.users.find({
        where: { role: UserRole.ADMIN, deletedAt: IsNull() },
        select: { id: true },
      });
      await Promise.all(
        admins.map((admin) =>
          this.notifications.createNotification({
            userId: admin.id,
            title: `AI operations ${snapshot.status}`,
            body: `${snapshot.stuckQueued} queued jobs are stuck, ${snapshot.stuckRunning} running jobs are stuck, and ${snapshot.failedRecent} jobs failed in the last 15 minutes.`,
          }),
        ),
      );
      this.lastAlertSignature = signature;
      this.lastAlertAt = Date.now();
      return snapshot;
    } catch (error) {
      this.logger.error(
        `AI operations monitor failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private enabled() {
    return this.config.get<string>('AI_JOB_MONITOR_ENABLED') !== 'false';
  }

  private number(name: string, fallback: number, minimum: number) {
    const value = Number(this.config.get<string>(name) ?? fallback);
    return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
  }
}
