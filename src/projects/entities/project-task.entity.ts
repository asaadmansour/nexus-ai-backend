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
import { MatchingCandidate } from '../../matching/entities/matching-candidate.entity';
import { MatchingRun } from '../../matching/entities/matching-run.entity';
import { User } from '../../users/entities/user.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectPlan } from './project-plan.entity';
import { ProjectRoleAssignment } from './project-role-assignment.entity';
import { ProjectSubmission } from './project-submission.entity';
import { ProjectTaskDependency } from './project-task-dependency.entity';
import { Project } from './project.entity';

@Entity('project_tasks')
@Index('project_tasks_project_status_idx', ['projectId', 'status'])
@Index('project_tasks_milestone_order_idx', ['milestoneId', 'orderIndex'], {
  where: '"milestone_id" IS NOT NULL',
})
@Index(
  'project_tasks_assignee_status_idx',
  ['assignedFreelancerProfileId', 'status'],
  {
    where: '"assigned_freelancer_profile_id" IS NOT NULL',
  },
)
@Index('project_tasks_source_matching_run_idx', ['sourceMatchingRunId'], {
  where: '"source_matching_run_id" IS NOT NULL',
})
@Index('project_tasks_assigned_at_idx', ['projectId', 'assignedAt'], {
  where: '"assigned_at" IS NOT NULL',
})
export class ProjectTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'project_plan_id', type: 'uuid', nullable: true })
  projectPlanId!: string | null;

  @ManyToOne(() => ProjectPlan, (plan) => plan.generatedTasks, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'project_plan_id' })
  projectPlan!: ProjectPlan | null;

  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId!: string | null;

  @ManyToOne(() => ProjectMilestone, (milestone) => milestone.tasks, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'milestone_id' })
  milestone!: ProjectMilestone | null;

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId!: string | null;

  @ManyToOne(() => ProjectRoleAssignment, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'assignment_id' })
  assignment!: ProjectRoleAssignment | null;

  @Column({
    name: 'assigned_freelancer_profile_id',
    type: 'uuid',
    nullable: true,
  })
  assignedFreelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_freelancer_profile_id' })
  assignedFreelancerProfile!: FreelancerProfile | null;

  @Column({ name: 'source_matching_run_id', type: 'uuid', nullable: true })
  sourceMatchingRunId!: string | null;

  @ManyToOne(() => MatchingRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_matching_run_id' })
  sourceMatchingRun!: MatchingRun | null;

  @Column({ name: 'source_candidate_id', type: 'uuid', nullable: true })
  sourceCandidateId!: string | null;

  @ManyToOne(() => MatchingCandidate, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_candidate_id' })
  sourceCandidate!: MatchingCandidate | null;

  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by' })
  assignedByUser!: User | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({
    name: 'hourly_rate_snapshot',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  hourlyRateSnapshot!: string | null;

  @Column({
    name: 'hourly_rate_currency_snapshot',
    type: 'varchar',
    length: 3,
    nullable: true,
  })
  hourlyRateCurrencySnapshot!: string | null;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'todo' })
  status!: string;

  @Column({ type: 'varchar', length: 40, default: 'medium' })
  priority!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 80, nullable: true })
  roleKey!: string | null;

  @Column({
    name: 'required_skills',
    type: 'text',
    array: true,
    nullable: true,
  })
  requiredSkills!: string[] | null;

  @Column({
    name: 'estimated_hours',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  estimatedHours!: string | null;

  @Column({
    name: 'budget_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  budgetAmount!: string | null;

  @Column({
    name: 'penalty_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  penaltyAmount!: string;

  @Column({ name: 'deadline_strikes', type: 'int', default: 0 })
  deadlineStrikes!: number;

  @Column({ name: 'max_deadline_strikes', type: 'int', default: 2 })
  maxDeadlineStrikes!: number;

  @Column({
    name: 'assignment_status',
    type: 'varchar',
    length: 40,
    default: 'unassigned',
  })
  assignmentStatus!: string;

  @Column({ type: 'char', length: 3, nullable: true })
  currency!: string | null;

  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex!: number;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ name: 'acceptance_criteria', type: 'jsonb', nullable: true })
  acceptanceCriteria!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @OneToMany(() => ProjectTaskDependency, (dependency) => dependency.task)
  dependencies?: ProjectTaskDependency[];

  @OneToMany(
    () => ProjectTaskDependency,
    (dependency) => dependency.dependsOnTask,
  )
  dependents?: ProjectTaskDependency[];

  @OneToMany(() => ProjectSubmission, (submission) => submission.task)
  submissions?: ProjectSubmission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
