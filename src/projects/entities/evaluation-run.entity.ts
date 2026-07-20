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
import { AgentJob } from '../../agents/entities/agent-job.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectSubmission } from './project-submission.entity';
import { ProjectTask } from './project-task.entity';
import { Project } from './project.entity';

@Entity('evaluation_runs')
@Index('evaluation_runs_project_status_idx', ['projectId', 'status'])
@Index('evaluation_runs_submission_status_idx', ['submissionId', 'status'], {
  where: '"submission_id" IS NOT NULL',
})
@Index('evaluation_runs_task_status_idx', ['taskId', 'status'], {
  where: '"task_id" IS NOT NULL',
})
export class EvaluationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.evaluationRuns, {
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

  @ManyToOne(
    () => ProjectSubmission,
    (submission) => submission.evaluationRuns,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'submission_id' })
  submission!: ProjectSubmission | null;

  @Column({ name: 'agent_job_id', type: 'uuid', nullable: true })
  agentJobId!: string | null;

  @ManyToOne(() => AgentJob, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agent_job_id' })
  agentJob!: AgentJob | null;

  @Column({ type: 'varchar', length: 40, default: 'queued' })
  status!: string;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  score!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  recommendation!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  findings!: Record<string, unknown> | null;

  @Column({ name: 'acceptance_coverage', type: 'jsonb', nullable: true })
  acceptanceCoverage!: Record<string, unknown> | null;

  @Column({
    name: 'risk_flags',
    type: 'text',
    array: true,
    nullable: true,
  })
  riskFlags!: string[] | null;

  @Column({ name: 'model_name', type: 'varchar', length: 120, nullable: true })
  modelName!: string | null;

  @Column({
    name: 'prompt_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  promptVersion!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
