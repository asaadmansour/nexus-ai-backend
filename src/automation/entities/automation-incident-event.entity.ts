import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AutomationIncident } from './automation-incident.entity';

@Entity('automation_incident_events')
@Index('automation_incident_events_incident_idx', ['incidentId', 'occurredAt'])
export class AutomationIncidentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'incident_id', type: 'uuid' })
  incidentId: string;

  @ManyToOne(() => AutomationIncident, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incident_id' })
  incident: AutomationIncident;

  @Column({ name: 'event_type', type: 'varchar', length: 20 })
  eventType: 'occurred' | 'reopened' | 'resolved';

  @Column({ type: 'varchar', length: 20 })
  severity: 'warning' | 'error' | 'critical';

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  context: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  trace: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
