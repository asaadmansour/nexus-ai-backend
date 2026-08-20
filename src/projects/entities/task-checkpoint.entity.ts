import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectTask } from './project-task.entity';

@Entity('task_checkpoints')
@Index('task_checkpoints_due_status_idx', ['status', 'dueAt'])
@Index('task_checkpoints_task_order_uidx', ['taskId', 'orderIndex'], {
  unique: true,
})
export class TaskCheckpoint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @ManyToOne(() => ProjectTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: ProjectTask;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex!: number;

  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt!: Date;

  @Column({ name: 'weight_percent', type: 'numeric', precision: 5, scale: 2 })
  weightPercent!: string;

  @Column({ name: 'penalty_percent', type: 'numeric', precision: 5, scale: 2 })
  penaltyPercent!: string;

  @Column({ name: 'grace_minutes', type: 'int', default: 60 })
  graceMinutes!: number;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status!: string;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'assessed_at', type: 'timestamptz', nullable: true })
  assessedAt!: Date | null;

  @Column({
    name: 'penalty_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  penaltyAmount!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
