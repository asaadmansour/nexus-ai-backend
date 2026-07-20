import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FreelancerProfile } from '../../freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from '../../projects/entities/project-milestone.entity';
import { ProjectSubmission } from '../../projects/entities/project-submission.entity';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { PaymentReleaseRequest } from './payment-release-request.entity';
import { ProjectPayment } from './project-payment.entity';

@Entity('escrow_ledger_entries')
@Index('escrow_ledger_entries_project_created_idx', ['projectId', 'createdAt'])
@Index('escrow_ledger_entries_payment_idx', ['paymentId'], {
  where: '"payment_id" IS NOT NULL',
})
@Index('escrow_ledger_entries_freelancer_idx', ['freelancerProfileId'], {
  where: '"freelancer_profile_id" IS NOT NULL',
})
export class EscrowLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId!: string | null;

  @ManyToOne(() => ProjectPayment, (payment) => payment.ledgerEntries, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'payment_id' })
  payment!: ProjectPayment | null;

  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId!: string | null;

  @ManyToOne(() => ProjectMilestone, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'milestone_id' })
  milestone!: ProjectMilestone | null;

  @Column({ name: 'approved_submission_id', type: 'uuid', nullable: true })
  approvedSubmissionId!: string | null;

  @ManyToOne(() => ProjectSubmission, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_submission_id' })
  approvedSubmission!: ProjectSubmission | null;

  @Column({ name: 'release_request_id', type: 'uuid', nullable: true })
  releaseRequestId!: string | null;

  @ManyToOne(() => PaymentReleaseRequest, (request) => request.ledgerEntries, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'release_request_id' })
  releaseRequest!: PaymentReleaseRequest | null;

  @Column({ name: 'freelancer_profile_id', type: 'uuid', nullable: true })
  freelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile | null;

  @Column({ name: 'entry_type', type: 'varchar', length: 40 })
  entryType!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'char', length: 3, default: 'EGP' })
  currency!: string;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({
    name: 'stripe_transfer_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeTransferId!: string | null;

  @Column({
    name: 'stripe_refund_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeRefundId!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser!: User | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
