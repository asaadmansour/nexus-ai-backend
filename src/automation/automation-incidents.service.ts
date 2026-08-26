import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { AutomationIncident } from './entities/automation-incident.entity';

export interface RecordAutomationIncidentInput {
  subsystem: string;
  operation: string;
  projectId?: string | null;
  errorCode?: string;
  severity?: 'warning' | 'error' | 'critical';
  message: string;
  context?: Record<string, unknown> | null;
}

@Injectable()
export class AutomationIncidentsService {
  constructor(
    @InjectRepository(AutomationIncident)
    private readonly incidents: Repository<AutomationIncident>,
  ) {}

  async record(input: RecordAutomationIncidentInput) {
    const normalized = this.normalize(input);
    const fingerprint = this.fingerprint(normalized);
    const now = new Date();
    const existing = await this.incidents.findOne({ where: { fingerprint } });
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
      return this.incidents.save(existing);
    }
    try {
      return await this.incidents.save(
        this.incidents.create({
          ...normalized,
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
      // Another application instance may have inserted the same fingerprint.
      const raced = await this.incidents.findOne({ where: { fingerprint } });
      if (!raced) throw error;
      raced.status = 'open';
      raced.message = normalized.message;
      raced.context = normalized.context;
      raced.occurrenceCount += 1;
      raced.lastOccurredAt = now;
      raced.resolvedAt = null;
      raced.resolutionNote = null;
      return this.incidents.save(raced);
    }
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
    for (const row of rows) {
      row.status = 'resolved';
      row.resolvedAt = now;
      row.resolutionNote = resolutionNote.slice(0, 2000);
    }
    await this.incidents.save(rows);
    return rows.length;
  }

  async list(filters: {
    status?: string;
    subsystem?: string;
    projectId?: string;
    limit: number;
  }) {
    const where: FindOptionsWhere<AutomationIncident> = {};
    if (filters.status === 'open' || filters.status === 'resolved') {
      where.status = filters.status;
    }
    if (filters.subsystem) where.subsystem = filters.subsystem;
    if (filters.projectId) where.projectId = filters.projectId;
    const [data, total] = await this.incidents.findAndCount({
      where,
      order: { status: 'ASC', lastOccurredAt: 'DESC' },
      take: filters.limit,
    });
    return { data, total };
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
    const secretPattern =
      /token|secret|password|authorization|cookie|api.?key/i;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretPattern.test(key))
        .slice(0, 30)
        .map(([key, entry]) => [
          key.slice(0, 100),
          typeof entry === 'string' ? entry.slice(0, 1000) : entry,
        ]),
    );
  }
}
