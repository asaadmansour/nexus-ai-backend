import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { FreelancerProfileEmbedding } from './freelancer-profile-embedding.entity';
import { FreelancerSkillScore } from './freelancer-skill-score.entity';

@Entity('freelancer_profiles')
@Index('freelancer_profiles_stripe_account_id_uidx', ['stripeAccountId'], {
  unique: true,
  where: '"stripe_account_id" IS NOT NULL',
})
export class FreelancerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.freelancerProfile, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => FreelancerProfileEmbedding, (embedding) => embedding.profile)
  embeddings?: FreelancerProfileEmbedding[];

  @OneToMany(
    () => FreelancerSkillScore,
    (skillScore) => skillScore.freelancerProfile,
  )
  skillScores?: FreelancerSkillScore[];

  @Column({ name: 'cv_url', type: 'text', nullable: true })
  cvUrl: string | null;

  @Column({
    name: 'cv_extraction_status',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  cvExtractionStatus: string | null;

  @Column({
    name: 'cv_extracted_at',
    type: 'timestamptz',
    nullable: true,
  })
  cvExtractedAt: Date | null;

  @Column({
    name: 'cv_extraction_error',
    type: 'text',
    nullable: true,
  })
  cvExtractionError: string | null;

  @Column({
    name: 'assessment_generation_status',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  assessmentGenerationStatus: string | null;

  @Column({
    name: 'assessment_generation_queued_at',
    type: 'timestamptz',
    nullable: true,
  })
  assessmentGenerationQueuedAt: Date | null;

  @Column({
    name: 'assessment_generation_started_at',
    type: 'timestamptz',
    nullable: true,
  })
  assessmentGenerationStartedAt: Date | null;

  @Column({
    name: 'assessment_generated_at',
    type: 'timestamptz',
    nullable: true,
  })
  assessmentGeneratedAt: Date | null;

  @Column({
    name: 'assessment_generation_error',
    type: 'text',
    nullable: true,
  })
  assessmentGenerationError: string | null;

  @Column({
    name: 'assessment_generation_job_id',
    type: 'uuid',
    nullable: true,
  })
  assessmentGenerationJobId: string | null;

  @Column({ type: 'text', nullable: true })
  headline: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  skills: string[] | null;

  @Column({ name: 'years_experience', type: 'int', nullable: true })
  yearsExperience: number | null;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  @Column({
    name: 'hourly_rate',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  hourlyRate: string | null;

  @Column({
    name: 'stripe_account_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeAccountId: string | null;

  @Column({
    name: 'stripe_onboarding_status',
    type: 'varchar',
    length: 40,
    default: 'not_started',
  })
  stripeOnboardingStatus: string;

  @Column({ name: 'stripe_charges_enabled', type: 'boolean', default: false })
  stripeChargesEnabled: boolean;

  @Column({ name: 'stripe_payouts_enabled', type: 'boolean', default: false })
  stripePayoutsEnabled: boolean;

  @Column({
    name: 'stripe_requirements_due',
    type: 'jsonb',
    nullable: true,
  })
  stripeRequirementsDue: Record<string, unknown> | null;

  @Column({
    name: 'stripe_onboarded_at',
    type: 'timestamptz',
    nullable: true,
  })
  stripeOnboardedAt: Date | null;

  @Column({ name: 'last_interview_at', type: 'timestamptz', nullable: true })
  lastInterviewAt: Date | null;

  @Column({
    name: 'interview_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  interviewScore: string | null;

  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 40,
    default: 'profile_incomplete',
  })
  verificationStatus: string;

  @Column({
    name: 'assessment_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  assessmentScore: string | null;

  @Column({
    name: 'assessment_submitted_at',
    type: 'timestamptz',
    nullable: true,
  })
  assessmentSubmittedAt: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Index('freelancer_profiles_is_available_idx')
  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable: boolean;

  @Column({ name: 'availability_hours_per_week', type: 'int', nullable: true })
  availabilityHoursPerWeek: number | null;

  @Column({
    name: 'avg_rating',
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
  })
  avgRating: string | null;

  @Column({ name: 'ratings_count', type: 'int', default: 0 })
  ratingsCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
