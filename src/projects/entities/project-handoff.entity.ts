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
import { User } from '../../users/entities/user.entity';
import { ProjectRepository } from './project-repository.entity';
import { Project } from './project.entity';

@Entity('project_handoffs')
@Index('project_handoffs_project_uidx', ['projectId'], { unique: true })
@Index('project_handoffs_status_retry_idx', ['status', 'nextAttemptAt'])
export class ProjectHandoff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'repository_id', type: 'uuid', nullable: true })
  repositoryId!: string | null;

  @ManyToOne(() => ProjectRepository, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'repository_id' })
  repository!: ProjectRepository | null;

  @Column({ type: 'varchar', length: 50, default: 'integrating' })
  status!: string;

  @Column({ name: 'integration_branch', type: 'varchar', length: 255 })
  integrationBranch!: string;

  @Column({
    name: 'integration_commit_sha',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  integrationCommitSha!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'live_url', type: 'text', nullable: true })
  liveUrl!: string | null;

  @Column({ name: 'artifact_urls', type: 'jsonb', nullable: true })
  artifactUrls!: string[] | null;

  @Column({ name: 'verification_report', type: 'jsonb', nullable: true })
  verificationReport!: Record<string, unknown> | null;

  @Column({ name: 'audit_bundle', type: 'jsonb', nullable: true })
  auditBundle!: Record<string, unknown> | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedByUser!: User | null;

  @Column({ name: 'reviewer_feedback', type: 'text', nullable: true })
  reviewerFeedback!: string | null;

  @Column({ name: 'reviewer_approved_at', type: 'timestamptz', nullable: true })
  reviewerApprovedAt!: Date | null;

  @Column({ name: 'client_review_due_at', type: 'timestamptz', nullable: true })
  clientReviewDueAt!: Date | null;

  @Column({ name: 'client_feedback', type: 'text', nullable: true })
  clientFeedback!: string | null;

  @Column({ name: 'client_accepted_at', type: 'timestamptz', nullable: true })
  clientAcceptedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
