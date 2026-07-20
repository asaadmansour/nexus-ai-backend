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
import { User } from '../../users/entities/user.entity';
import { EvaluationRun } from './evaluation-run.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectRepository } from './project-repository.entity';
import { ProjectRoleAssignment } from './project-role-assignment.entity';
import { ProjectSubmissionReview } from './project-submission-review.entity';
import { ProjectTask } from './project-task.entity';
import { Project } from './project.entity';

@Entity('project_submissions')
@Index('project_submissions_project_status_idx', ['projectId', 'status'])
@Index('project_submissions_task_status_idx', ['taskId', 'status'], {
  where: '"task_id" IS NOT NULL',
})
@Index(
  'project_submissions_freelancer_status_idx',
  ['freelancerProfileId', 'status'],
  {
    where: '"freelancer_profile_id" IS NOT NULL',
  },
)
@Index(
  'project_submissions_task_freelancer_version_uidx',
  ['taskId', 'freelancerProfileId', 'version'],
  {
    unique: true,
    where: '"task_id" IS NOT NULL AND "freelancer_profile_id" IS NOT NULL',
  },
)
@Index(
  'project_submissions_milestone_freelancer_version_uidx',
  ['milestoneId', 'freelancerProfileId', 'version'],
  {
    unique: true,
    where: '"milestone_id" IS NOT NULL AND "freelancer_profile_id" IS NOT NULL',
  },
)
export class ProjectSubmission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.submissions, {
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

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId!: string | null;

  @ManyToOne(() => ProjectRoleAssignment, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'assignment_id' })
  assignment!: ProjectRoleAssignment | null;

  @Column({ name: 'freelancer_profile_id', type: 'uuid', nullable: true })
  freelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile | null;

  @Column({ name: 'repository_id', type: 'uuid', nullable: true })
  repositoryId!: string | null;

  @ManyToOne(() => ProjectRepository, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'repository_id' })
  repository!: ProjectRepository | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 40, default: 'draft' })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  content!: Record<string, unknown> | null;

  @Column({ name: 'file_urls', type: 'jsonb', nullable: true })
  fileUrls!: Record<string, unknown> | null;

  @Column({ name: 'repo_url', type: 'varchar', length: 500, nullable: true })
  repoUrl!: string | null;

  @Column({ name: 'branch_name', type: 'varchar', length: 255, nullable: true })
  branchName!: string | null;

  @Column({
    name: 'pull_request_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  pullRequestUrl!: string | null;

  @Column({ name: 'commit_sha', type: 'varchar', length: 80, nullable: true })
  commitSha!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedByUser!: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @OneToMany(() => ProjectSubmissionReview, (review) => review.submission)
  reviews?: ProjectSubmissionReview[];

  @OneToMany(() => EvaluationRun, (run) => run.submission)
  evaluationRuns?: EvaluationRun[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
