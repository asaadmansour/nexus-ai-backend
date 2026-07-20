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
import { FreelancerProfile } from '../../freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from '../../projects/entities/project-milestone.entity';
import { ProjectSubmission } from '../../projects/entities/project-submission.entity';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { EscrowLedgerEntry } from './escrow-ledger-entry.entity';
import { ProjectPayment } from './project-payment.entity';

@Entity('payment_release_requests')
@Index('payment_release_requests_project_status_idx', ['projectId', 'status'])
@Index('payment_release_requests_milestone_status_idx', [
  'milestoneId',
  'status',
])
@Index('payment_release_requests_submission_status_idx', [
  'submissionId',
  'status',
])
@Index(
  'payment_release_requests_pending_milestone_uidx',
  ['milestoneId', 'freelancerProfileId'],
  {
    unique: true,
    where:
      '"milestone_id" IS NOT NULL AND "freelancer_profile_id" IS NOT NULL AND "status" IN (\'pending\', \'approved\')',
  },
)
export class PaymentReleaseRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId!: string | null;

  @ManyToOne(() => ProjectMilestone, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'milestone_id' })
  milestone!: ProjectMilestone | null;

  @Column({ name: 'submission_id', type: 'uuid', nullable: true })
  submissionId!: string | null;

  @ManyToOne(() => ProjectSubmission, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'submission_id' })
  submission!: ProjectSubmission | null;

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId!: string | null;

  @ManyToOne(() => ProjectPayment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_id' })
  payment!: ProjectPayment | null;

  @Column({ name: 'freelancer_profile_id', type: 'uuid', nullable: true })
  freelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  amount!: string;

  @Column({ type: 'char', length: 3, default: 'EGP' })
  currency!: string;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes!: string | null;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by' })
  requestedByUser!: User | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedByUser!: User | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @OneToMany(() => EscrowLedgerEntry, (entry) => entry.releaseRequest)
  ledgerEntries?: EscrowLedgerEntry[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
