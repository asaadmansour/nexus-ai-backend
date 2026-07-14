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
import { ProjectPayment } from '../../payments/entities/project-payment.entity';
import { ProjectPlan } from './project-plan.entity';
import { ProjectTask } from './project-task.entity';
import { Project } from './project.entity';

@Entity('project_milestones')
@Index('project_milestones_project_order_idx', ['projectId', 'orderIndex'])
@Index('project_milestones_project_status_idx', ['projectId', 'status'])
export class ProjectMilestone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.milestones, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'project_plan_id', type: 'uuid', nullable: true })
  projectPlanId!: string | null;

  @ManyToOne(() => ProjectPlan, (plan) => plan.generatedMilestones, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'project_plan_id' })
  projectPlan!: ProjectPlan | null;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'planned' })
  status!: string;

  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex!: number;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({
    name: 'budget_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  budgetAmount!: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  currency!: string | null;

  @Column({ name: 'acceptance_criteria', type: 'jsonb', nullable: true })
  acceptanceCriteria!: Record<string, unknown> | null;

  @OneToMany(() => ProjectTask, (task) => task.milestone)
  tasks?: ProjectTask[];

  @OneToMany(() => ProjectPayment, (payment) => payment.milestone)
  payments?: ProjectPayment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
