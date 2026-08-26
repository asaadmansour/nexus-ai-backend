import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('automation_incidents')
@Index('automation_incidents_status_last_idx', ['status', 'lastOccurredAt'])
@Index('automation_incidents_project_idx', ['projectId', 'lastOccurredAt'])
export class AutomationIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  fingerprint: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 50 })
  subsystem: string;

  @Column({ type: 'varchar', length: 100 })
  operation: string;

  @Column({ name: 'error_code', type: 'varchar', length: 80 })
  errorCode: string;

  @Column({ type: 'varchar', length: 20, default: 'error' })
  severity: 'warning' | 'error' | 'critical';

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: 'open' | 'resolved';

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  context: Record<string, unknown> | null;

  @Column({ name: 'occurrence_count', type: 'int', default: 1 })
  occurrenceCount: number;

  @Column({ name: 'first_occurred_at', type: 'timestamptz' })
  firstOccurredAt: Date;

  @Column({ name: 'last_occurred_at', type: 'timestamptz' })
  lastOccurredAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
