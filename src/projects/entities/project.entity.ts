import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { User } from '../../users/entities/user.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('projects_customer_id_idx')
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'deadline', type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @Column({ name: 'is_deadline_flexible', type: 'boolean', default: true })
  isDeadlineFlexible: boolean;

  @Column({ name: 'budget_min', type: 'numeric', precision: 12, scale: 2 })
  budgetMin: string;

  @Column({ name: 'budget_max', type: 'numeric', precision: 12, scale: 2 })
  budgetMax: string;

  @Column({ type: 'char', length: 3, default: 'EGP' })
  currency: string;

  // Cache only; source of truth is escrow_transactions.
  @Column({ name: 'held_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  heldAmount: string;

  @Column({ name: 'released_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  releasedAmount: string;

  @Index('projects_status_idx')
  @Column({
    type: 'enum',
    enum: ProjectStatus,
    enumName: 'project_status',
    default: ProjectStatus.DRAFT,
  })
  status: ProjectStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
