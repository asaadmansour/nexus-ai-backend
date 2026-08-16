import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('github_webhook_events')
@Index('github_webhook_events_delivery_uidx', ['deliveryId'], { unique: true })
@Index('github_webhook_events_type_created_idx', ['eventType', 'createdAt'])
export class GithubWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'delivery_id', type: 'varchar', length: 120 })
  deliveryId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  @Column({
    name: 'repository_full_name',
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  repositoryFullName!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({
    name: 'processing_started_at',
    type: 'timestamptz',
    nullable: true,
  })
  processingStartedAt!: Date | null;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
