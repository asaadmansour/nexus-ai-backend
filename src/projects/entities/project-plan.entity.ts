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
import { AgentJob } from '../../agents/entities/agent-job.entity';
import { User } from '../../users/entities/user.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectPlanningSubmission } from './project-planning-submission.entity';
import { ProjectTask } from './project-task.entity';
import { Project } from './project.entity';

@Entity('project_plans')
@Index('project_plans_project_status_idx', ['projectId', 'status'])
@Index('project_plans_project_version_uidx', ['projectId', 'version'], {
  unique: true,
})
@Index('project_plans_current_uidx', ['projectId'], {
  unique: true,
  where: '"is_current" = true',
})
export class ProjectPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 40, default: 'generated' })
  status!: string;

  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent!: boolean;

  @Column({
    name: 'architecture_submission_id',
    type: 'uuid',
    nullable: true,
  })
  architectureSubmissionId!: string | null;

  @ManyToOne(() => ProjectPlanningSubmission, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'architecture_submission_id' })
  architectureSubmission!: ProjectPlanningSubmission | null;

  @Column({ name: 'uiux_submission_id', type: 'uuid', nullable: true })
  uiuxSubmissionId!: string | null;

  @ManyToOne(() => ProjectPlanningSubmission, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'uiux_submission_id' })
  uiuxSubmission!: ProjectPlanningSubmission | null;

  @Column({ name: 'generated_by_job_id', type: 'uuid', nullable: true })
  generatedByJobId!: string | null;

  @ManyToOne(() => AgentJob, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'generated_by_job_id' })
  generatedByJob!: AgentJob | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  assumptions!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  timeline!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  milestones!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  tasks!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  dependencies!: Record<string, unknown> | null;

  @Column({ name: 'project_spec', type: 'jsonb', nullable: true })
  projectSpec!: Record<string, unknown> | null;

  @Column({ name: 'team_plan', type: 'jsonb', nullable: true })
  teamPlan!: Record<string, unknown> | null;

  @Column({ name: 'risk_register', type: 'jsonb', nullable: true })
  riskRegister!: Record<string, unknown> | null;

  @Column({ name: 'admin_notes', type: 'text', nullable: true })
  adminNotes!: string | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approvedByUser!: User | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @OneToMany(() => ProjectMilestone, (milestone) => milestone.projectPlan)
  generatedMilestones?: ProjectMilestone[];

  @OneToMany(() => ProjectTask, (task) => task.projectPlan)
  generatedTasks?: ProjectTask[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
