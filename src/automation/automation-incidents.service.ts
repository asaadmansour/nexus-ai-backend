import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import {
  FindOptionsWhere,
  In,
  IsNull,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { UserRole } from 'src/common/enums/user-role.enum';
import { NotificationsService } from 'src/notifications/notifications.service';
import { User } from 'src/users/entities/user.entity';
import { AutomationIncident } from './entities/automation-incident.entity';
import { AutomationIncidentEvent } from './entities/automation-incident-event.entity';

export interface RecordAutomationIncidentInput {
  subsystem: string;
  operation: string;
  projectId?: string | null;
  errorCode?: string;
  severity?: 'warning' | 'error' | 'critical';
  message: string;
  context?: Record<string, unknown> | null;
  trace?: string | null;
}

export interface IncidentSuggestedAction {
  key: string;
  label: string;
  description: string;
  href: string | null;
  priority: 'primary' | 'secondary';
}

@Injectable()
export class AutomationIncidentsService {
  private readonly logger = new Logger(AutomationIncidentsService.name);

  constructor(
    @InjectRepository(AutomationIncident)
    private readonly incidents: Repository<AutomationIncident>,
    @InjectRepository(AutomationIncidentEvent)
    private readonly events: Repository<AutomationIncidentEvent>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  async record(input: RecordAutomationIncidentInput) {
    const normalized = this.normalize(input);
    const fingerprint = this.fingerprint(normalized);
    const now = new Date();
    const existing = await this.incidents.findOne({ where: { fingerprint } });
    const wasResolved = existing?.status === 'resolved';
    let eventType: 'occurred' | 'reopened' = wasResolved
      ? 'reopened'
      : 'occurred';
    let shouldNotify = !existing || wasResolved;
    let saved: AutomationIncident;

    if (existing) {
      existing.projectId = normalized.projectId;
      existing.status = 'open';
      existing.severity = normalized.severity;
      existing.message = normalized.message;
      existing.context = normalized.context;
      existing.occurrenceCount += 1;
      existing.lastOccurredAt = now;
      existing.resolvedAt = null;
      existing.resolutionNote = null;
      saved = await this.incidents.save(existing);
    } else {
      try {
        const { trace: _trace, ...incidentValues } = normalized;
        saved = await this.incidents.save(
          this.incidents.create({
            ...incidentValues,
            fingerprint,
            status: 'open',
            occurrenceCount: 1,
            firstOccurredAt: now,
            lastOccurredAt: now,
            resolvedAt: null,
            resolutionNote: null,
          }),
        );
      } catch (error) {
        // Another application instance may have inserted the fingerprint.
        const raced = await this.incidents.findOne({ where: { fingerprint } });
        if (!raced) throw error;
        const racedWasResolved = raced.status === 'resolved';
        eventType = racedWasResolved ? 'reopened' : 'occurred';
        shouldNotify = racedWasResolved;
        raced.status = 'open';
        raced.severity = normalized.severity;
        raced.message = normalized.message;
        raced.context = normalized.context;
        raced.occurrenceCount += 1;
        raced.lastOccurredAt = now;
        raced.resolvedAt = null;
        raced.resolutionNote = null;
        saved = await this.incidents.save(raced);
      }
    }

    await this.appendEvent(saved, {
      eventType,
      severity: normalized.severity,
      message: normalized.message,
      context: normalized.context,
      trace: normalized.trace,
      occurredAt: now,
    });
    if (shouldNotify) await this.notifyAdmins(saved);
    return saved;
  }

  async resolveOperation(
    subsystem: string,
    operation: string,
    projectId?: string | null,
    resolutionNote = 'A later automation run completed successfully.',
  ) {
    const where: FindOptionsWhere<AutomationIncident> = {
      subsystem: subsystem.slice(0, 50),
      operation: operation.slice(0, 100),
      projectId: projectId ?? IsNull(),
      status: 'open',
    };
    const rows = await this.incidents.find({ where });
    if (!rows.length) return 0;
    const now = new Date();
    const note = resolutionNote.trim().slice(0, 2000) || 'Resolved';
    for (const row of rows) {
      row.status = 'resolved';
      row.resolvedAt = now;
      row.resolutionNote = note;
    }
    const saved = await this.incidents.save(rows);
    await Promise.all(
      saved.map((row) =>
        this.appendEvent(row, {
          eventType: 'resolved',
          severity: row.severity,
          message: note,
          context: null,
          trace: null,
          occurredAt: now,
        }),
      ),
    );
    return rows.length;
  }

  async resolveById(id: string, resolutionNote?: string) {
    const incident = await this.incidents.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Automation incident not found');
    if (incident.status === 'resolved') return this.toView(incident);
    const now = new Date();
    const note =
      resolutionNote?.trim().slice(0, 2000) ||
      'Marked resolved by an administrator.';
    incident.status = 'resolved';
    incident.resolvedAt = now;
    incident.resolutionNote = note;
    const saved = await this.incidents.save(incident);
    await this.appendEvent(saved, {
      eventType: 'resolved',
      severity: saved.severity,
      message: note,
      context: null,
      trace: null,
      occurredAt: now,
    });
    return this.toView(saved);
  }

  async list(filters: {
    status?: string;
    subsystem?: string;
    projectId?: string;
    severity?: string;
    search?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset?: number;
  }) {
    const query = this.incidents.createQueryBuilder('incident');
    if (filters.status === 'open' || filters.status === 'resolved') {
      query.andWhere('incident.status = :status', { status: filters.status });
    }
    if (filters.subsystem) {
      query.andWhere('incident.subsystem = :subsystem', {
        subsystem: filters.subsystem,
      });
    }
    if (filters.projectId) {
      query.andWhere('incident.projectId = :projectId', {
        projectId: filters.projectId,
      });
    }
    if (['warning', 'error', 'critical'].includes(filters.severity ?? '')) {
      query.andWhere('incident.severity = :severity', {
        severity: filters.severity,
      });
    }
    if (filters.from) {
      query.andWhere('incident.lastOccurredAt >= :from', {
        from: filters.from,
      });
    }
    if (filters.to) {
      query.andWhere('incident.lastOccurredAt <= :to', { to: filters.to });
    }
    if (filters.search) {
      query.andWhere(
        '(incident.message ILIKE :search OR incident.errorCode ILIKE :search OR incident.operation ILIKE :search)',
        {
          search: `%${filters.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
        },
      );
    }
    const [data, total] = await query
      .orderBy("CASE WHEN incident.status = 'open' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('incident.lastOccurredAt', 'DESC')
      .skip(filters.offset ?? 0)
      .take(filters.limit)
      .getManyAndCount();
    return { data: data.map((incident) => this.toView(incident)), total };
  }

  async detail(id: string) {
    const incident = await this.incidents.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Automation incident not found');
    const events = await this.events.find({
      where: { incidentId: id },
      order: { occurredAt: 'DESC' },
      take: 100,
    });
    return {
      incident: this.toView(incident),
      events: events.map((event) => ({
        ...event,
        traceId: this.traceId('EVT', event.id),
      })),
    };
  }

  async summary(windowDays: number) {
    const safeWindow = Math.max(1, Math.min(windowDays, 90));
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (safeWindow - 1));
    const [open, criticalOpen, windowEvents, resolvedRows] = await Promise.all([
      this.incidents.find({ where: { status: 'open' } }),
      this.incidents.count({
        where: { status: 'open', severity: 'critical' },
      }),
      this.events.find({
        where: {
          occurredAt: MoreThanOrEqual(since),
          eventType: In(['occurred', 'reopened']),
        },
        relations: { incident: true },
      }),
      this.incidents.find({
        where: { resolvedAt: MoreThanOrEqual(since) },
      }),
    ]);
    const bySeverity = this.countBy(windowEvents, (row) => row.severity);
    const bySubsystem = this.countBy(
      windowEvents,
      (row) => row.incident.subsystem,
    );
    const byErrorCode = Object.entries(
      this.countBy(windowEvents, (row) => row.incident.errorCode),
    )
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([errorCode, count]) => ({ errorCode, count }));
    const daily = Array.from({ length: safeWindow }, (_, index) => {
      const date = new Date(since.getTime() + index * 86_400_000);
      return { date: date.toISOString().slice(0, 10), count: 0 };
    });
    for (const row of windowEvents) {
      const key = row.occurredAt.toISOString().slice(0, 10);
      const bucket = daily.find((entry) => entry.date === key);
      if (bucket) bucket.count += 1;
    }
    const resolutionDurations = resolvedRows
      .filter((row) => row.resolvedAt)
      .map(
        (row) =>
          (row.resolvedAt!.getTime() - row.firstOccurredAt.getTime()) / 60_000,
      )
      .filter((minutes) => minutes >= 0);
    return {
      generatedAt: new Date().toISOString(),
      windowDays: safeWindow,
      totalOpen: open.length,
      criticalOpen,
      recurringOpen: open.filter((row) => row.occurrenceCount > 1).length,
      occurredInWindow: windowEvents.length,
      resolvedInWindow: resolvedRows.length,
      impactedProjects: new Set(
        windowEvents.map((row) => row.incident.projectId).filter(Boolean),
      ).size,
      averageResolutionMinutes: resolutionDurations.length
        ? Math.round(
            resolutionDurations.reduce((sum, value) => sum + value, 0) /
              resolutionDurations.length,
          )
        : null,
      bySeverity,
      bySubsystem,
      byErrorCode,
      daily,
    };
  }

  private async appendEvent(
    incident: AutomationIncident,
    event: Omit<
      AutomationIncidentEvent,
      'id' | 'incidentId' | 'incident' | 'createdAt'
    >,
  ) {
    try {
      await this.events.save(
        this.events.create({ ...event, incidentId: incident.id }),
      );
    } catch (error) {
      this.logger.error(
        `Could not append incident event ${incident.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async notifyAdmins(incident: AutomationIncident) {
    try {
      const admins = await this.users.find({
        where: { role: UserRole.ADMIN, deletedAt: IsNull() },
        select: { id: true },
      });
      const traceId = this.traceId('INC', incident.id);
      await Promise.all(
        admins.map((admin) =>
          this.notifications.createNotification({
            userId: admin.id,
            projectId: incident.projectId,
            type: 'automation_incident',
            title: `${this.label(incident.subsystem)} automation needs attention`,
            body: `${this.label(incident.operation)} failed (${incident.errorCode}). Trace ${traceId}. Open the incident for evidence and recovery guidance.`,
            actionUrl: `/dashboard/admin/automation-incidents/${incident.id}`,
            metadata: { incidentId: incident.id, traceId },
            sendEmail: incident.severity !== 'warning',
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Could not notify admins for incident ${incident.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toView(incident: AutomationIncident) {
    return {
      ...incident,
      traceId: this.traceId('INC', incident.id),
      suggestedActions: this.suggestedActions(incident),
    };
  }

  private suggestedActions(
    incident: AutomationIncident,
  ): IncidentSuggestedAction[] {
    const projectSuffix = incident.projectId
      ? `?projectId=${incident.projectId}`
      : '';
    const workspace: Record<string, IncidentSuggestedAction> = {
      matching: {
        key: 'inspect_matching',
        label: 'Inspect matching diagnostics',
        description:
          'Review candidate availability, role fit, invitation delivery, and rate constraints before the next automatic retry.',
        href: `/dashboard/admin/matching${projectSuffix}`,
        priority: 'primary',
      },
      planning: {
        key: 'inspect_planning',
        label: 'Inspect project plans',
        description:
          'Review plan generation and materialisation state, including the latest agent failure.',
        href: '/dashboard/admin/project-plans',
        priority: 'primary',
      },
      repositories: {
        key: 'inspect_repository',
        label: 'Inspect repository automation',
        description:
          'Verify GitHub configuration, repository state, and collaborator usernames, then use the safe retry in the repository workspace.',
        href: `/dashboard/admin/repositories${projectSuffix}`,
        priority: 'primary',
      },
      payouts: {
        key: 'inspect_payout',
        label: 'Inspect payment release',
        description:
          'Verify the ledger entry and Stripe Connect status. Do not create a second manual transfer for the same ledger entry.',
        href: '/dashboard/admin/payment-release-requests',
        priority: 'primary',
      },
      ai_jobs: {
        key: 'inspect_agent_jobs',
        label: 'Inspect agent jobs',
        description:
          'Open failed and stuck jobs to review attempts, provider errors, payloads, and safe retry controls.',
        href: '/dashboard/admin/agent-jobs',
        priority: 'primary',
      },
      requirements_documents: {
        key: 'inspect_requirements',
        label: 'Inspect project requirements',
        description:
          'Confirm the stored document, processing attempts, and extraction status before retrying.',
        href: incident.projectId
          ? `/dashboard/admin/projects/${incident.projectId}/delivery`
          : '/dashboard/admin/projects',
        priority: 'primary',
      },
      delivery: {
        key: 'inspect_delivery',
        label: 'Inspect delivery and handoff',
        description:
          'Review submission, integration, verification, and handoff state before overriding automation.',
        href: incident.projectId
          ? `/dashboard/admin/projects/${incident.projectId}/delivery`
          : '/dashboard/admin/delivery',
        priority: 'primary',
      },
    };
    const actions = [
      workspace[incident.subsystem] ?? {
        key: 'inspect_operations',
        label: 'Inspect affected operation',
        description:
          'Use the trace, occurrence history, and context below to identify the failing resource before intervening.',
        href: incident.projectId
          ? `/dashboard/admin/projects/${incident.projectId}/delivery`
          : null,
        priority: 'primary' as const,
      },
    ];
    const required = incident.context?.actionRequired;
    if (typeof required === 'string' && required.trim()) {
      actions.push({
        key: 'recommended_recovery',
        label: 'Apply recommended recovery',
        description: required.trim().slice(0, 1000),
        href: null,
        priority: 'secondary',
      });
    }
    actions.push({
      key: 'observe_retry',
      label: 'Confirm the automatic retry',
      description:
        'After correcting the cause, leave the incident open until a successful automation run resolves it automatically. Resolve it manually only when the cause was handled outside Nexus AI.',
      href: null,
      priority: 'secondary',
    });
    return actions;
  }

  private normalize(input: RecordAutomationIncidentInput) {
    return {
      subsystem: input.subsystem.trim().slice(0, 50),
      operation: input.operation.trim().slice(0, 100),
      projectId: input.projectId ?? null,
      errorCode: (input.errorCode ?? 'runtime_failure').trim().slice(0, 80),
      severity: input.severity ?? ('error' as const),
      message: input.message.trim().slice(0, 4000) || 'Automation failed',
      context: this.safeContext(input.context),
      trace: this.safeTrace(input.trace),
    };
  }

  private fingerprint(input: {
    subsystem: string;
    operation: string;
    projectId: string | null;
    errorCode: string;
  }) {
    return createHash('sha256')
      .update(
        [
          input.subsystem,
          input.operation,
          input.projectId ?? 'global',
          input.errorCode,
        ].join('|'),
      )
      .digest('hex');
  }

  private safeContext(value: Record<string, unknown> | null | undefined) {
    if (!value) return null;
    return this.safeValue(value, 0, new WeakSet()) as Record<string, unknown>;
  }

  private safeValue(
    value: unknown,
    depth: number,
    seen: WeakSet<object>,
  ): unknown {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    )
      return value;
    if (typeof value === 'string') return value.slice(0, 2000);
    if (typeof value !== 'object' || depth >= 5)
      return String(value).slice(0, 500);
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const secretPattern =
      /token|secret|password|authorization|cookie|api.?key|credential/i;
    if (Array.isArray(value)) {
      return value
        .slice(0, 30)
        .map((entry) => this.safeValue(entry, depth + 1, seen));
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretPattern.test(key))
        .slice(0, 50)
        .map(([key, entry]) => [
          key.slice(0, 100),
          this.safeValue(entry, depth + 1, seen),
        ]),
    );
  }

  private safeTrace(value: string | null | undefined) {
    if (!value) return null;
    return value
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
      .replace(
        /(token|secret|password|api.?key|authorization)(["'\s:=]+)[^\s,;]+/gi,
        '$1$2[redacted]',
      )
      .slice(0, 12_000);
  }

  private traceId(prefix: string, id: string) {
    return `${prefix}-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  }

  private label(value: string) {
    return value
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private countBy<T>(rows: T[], key: (row: T) => string) {
    return Object.fromEntries(
      [
        ...rows.reduce((counts, row) => {
          const value = key(row);
          counts.set(value, (counts.get(value) ?? 0) + 1);
          return counts;
        }, new Map<string, number>()),
      ].sort(([left], [right]) => left.localeCompare(right)),
    );
  }
}
