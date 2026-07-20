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
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectSubmission } from './project-submission.entity';
import { ProjectTask } from './project-task.entity';
import { Project } from './project.entity';

@Entity('project_revision_requests')
@Index('project_revision_requests_project_status_idx', ['projectId', 'status'])
@Index('project_revision_requests_task_status_idx', ['taskId', 'status'], {
  where: '"task_id" IS NOT NULL',
})
@Index(
  'project_revision_requests_assignee_status_idx',
  ['assignedToFreelancerProfileId', 'status'],
  {
    where: '"assigned_to_freelancer_profile_id" IS NOT NULL',
  },
)
export class ProjectRevisionRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.revisionRequests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

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

  @Column({ name: 'submission_id', type: 'uuid', nullable: true })
  submissionId!: string | null;

  @ManyToOne(() => ProjectSubmission, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'submission_id' })
  submission!: ProjectSubmission | null;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by' })
  requestedByUser!: User | null;

  @Column({
    name: 'assigned_to_freelancer_profile_id',
    type: 'uuid',
    nullable: true,
  })
  assignedToFreelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to_freelancer_profile_id' })
  assignedToFreelancerProfile!: FreelancerProfile | null;

  @Column({ type: 'varchar', length: 40, default: 'open' })
  status!: string;

  @Column({ type: 'varchar', length: 40, default: 'medium' })
  priority!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'requested_changes', type: 'jsonb', nullable: true })
  requestedChanges!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
