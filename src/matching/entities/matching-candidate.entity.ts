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
import { FreelancerProfile } from '../../freelancers/entities/freelancer-profile.entity';
import { User } from '../../users/entities/user.entity';
import { MatchingRun } from './matching-run.entity';

@Entity('matching_candidates')
@Index(
  'matching_candidates_run_profile_uidx',
  ['matchingRunId', 'freelancerProfileId'],
  {
    unique: true,
    where: '"freelancer_profile_id" IS NOT NULL',
  },
)
@Index('matching_candidates_run_rank_idx', ['matchingRunId', 'rank'])
@Index(
  'matching_candidates_profile_status_idx',
  ['freelancerProfileId', 'status'],
  {
    where: '"freelancer_profile_id" IS NOT NULL',
  },
)
export class MatchingCandidate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'matching_run_id', type: 'uuid' })
  matchingRunId!: string;

  @ManyToOne(() => MatchingRun, (run) => run.candidates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'matching_run_id' })
  matchingRun!: MatchingRun;

  @Column({ name: 'freelancer_profile_id', type: 'uuid', nullable: true })
  freelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile | null;

  @Column({ type: 'int' })
  rank!: number;

  @Column({ type: 'numeric', precision: 6, scale: 2 })
  score!: string;

  @Column({ name: 'score_breakdown', type: 'jsonb', nullable: true })
  scoreBreakdown!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 40, default: 'recommended' })
  status!: string;

  @Column({ name: 'selected_by', type: 'uuid', nullable: true })
  selectedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'selected_by' })
  selectedByUser!: User | null;

  @Column({ name: 'selected_at', type: 'timestamptz', nullable: true })
  selectedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
