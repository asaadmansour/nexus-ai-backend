import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectMilestone } from '../../projects/entities/project-milestone.entity';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { EscrowLedgerEntry } from './escrow-ledger-entry.entity';
import { PaymentReleaseRequest } from './payment-release-request.entity';

@Entity('project_payments')
@Index('project_payments_project_status_idx', ['projectId', 'status'])
@Index('project_payments_customer_status_idx', ['customerId', 'status'])
@Index('project_payments_intent_uidx', ['stripePaymentIntentId'], {
  unique: true,
  where: '"stripe_payment_intent_id" IS NOT NULL',
})
@Index('project_payments_checkout_session_uidx', ['stripeCheckoutSessionId'], {
  unique: true,
  where: '"stripe_checkout_session_id" IS NOT NULL',
})
export class ProjectPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId!: string | null;

  @ManyToOne(() => ProjectMilestone, (milestone) => milestone.payments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'milestone_id' })
  milestone!: ProjectMilestone | null;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: User;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripePaymentIntentId!: string | null;

  @Column({
    name: 'stripe_checkout_session_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeCheckoutSessionId!: string | null;

  @Column({
    name: 'stripe_invoice_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeInvoiceId!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'char', length: 3, default: 'EGP' })
  currency!: string;

  @Column({ type: 'varchar', length: 40, default: 'requires_payment' })
  status!: string;

  @Column({ type: 'varchar', length: 60 })
  purpose!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @OneToMany(() => EscrowLedgerEntry, (entry) => entry.payment)
  ledgerEntries?: EscrowLedgerEntry[];

  @OneToMany(() => PaymentReleaseRequest, (request) => request.payment)
  releaseRequests?: PaymentReleaseRequest[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
