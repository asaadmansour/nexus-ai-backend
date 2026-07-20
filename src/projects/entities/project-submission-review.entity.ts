import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectSubmission } from './project-submission.entity';
import { ProjectTask } from './project-task.entity';
import { Project } from './project.entity';

@Entity('project_submission_reviews')
@Index('project_submission_reviews_submission_created_idx', [
  'submissionId',
  'createdAt',
])
@Index('project_submission_reviews_project_decision_idx', [
  'projectId',
  'decision',
])
@Index('project_submission_reviews_reviewer_created_idx', [
  'reviewerUserId',
  'createdAt',
])
export class ProjectSubmissionReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.submissionReviews, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @ManyToOne(() => ProjectSubmission, (submission) => submission.reviews, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'submission_id' })
  submission!: ProjectSubmission;

  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId!: string | null;

  @ManyToOne(() => ProjectMilestone, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'milestone_id' })
  milestone!: ProjectMilestone | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => ProjectTask, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id' })
  task!: ProjectTask | null;

  @Column({ name: 'reviewer_user_id', type: 'uuid', nullable: true })
  reviewerUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewer_user_id' })
  reviewer!: User | null;

  @Column({ name: 'reviewer_role', type: 'varchar', length: 40 })
  reviewerRole!: string;

  @Column({ type: 'varchar', length: 40 })
  decision!: string;

  @Column({ type: 'text', nullable: true })
  feedback!: string | null;

  @Column({ name: 'requested_changes', type: 'jsonb', nullable: true })
  requestedChanges!: Record<string, unknown> | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  score!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
