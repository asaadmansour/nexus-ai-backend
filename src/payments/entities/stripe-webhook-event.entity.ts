import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('stripe_webhook_events')
@Index('stripe_webhook_events_event_uidx', ['stripeEventId'], { unique: true })
@Index('stripe_webhook_events_type_created_idx', ['eventType', 'createdAt'])
export class StripeWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    name: 'stripe_event_id',
    type: 'varchar',
    length: 255,
  })
  stripeEventId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
