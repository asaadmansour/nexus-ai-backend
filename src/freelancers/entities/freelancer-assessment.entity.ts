import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { FreelancerProfile } from './freelancer-profile.entity';

@Entity('freelancer_assessments')
export class FreelancerAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId: string;

  @ManyToOne(() => FreelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile: FreelancerProfile;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status: string;

  @Column({ name: 'duration_seconds', type: 'int' })
  durationSeconds: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  score: string | null;

  @Column({ name: 'ai_feedback', type: 'jsonb', nullable: true })
  aiFeedback: Record<string, unknown> | null;

  @Column({ name: 'generated_from_cv_url', type: 'text', nullable: true })
  generatedFromCvUrl: string | null;

  @Column({ name: 'generation_job_id', type: 'uuid', nullable: true })
  generationJobId: string | null;

  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @Column({ name: 'generation_input', type: 'jsonb', nullable: true })
  generationInput: Record<string, unknown> | null;

  @Column({ name: 'generation_error', type: 'text', nullable: true })
  generationError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
