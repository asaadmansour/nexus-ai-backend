import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ProjectPlan } from './project-plan.entity';
import { Project } from './project.entity';

@Entity('project_specs')
export class ProjectSpec {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid', unique: true })
  projectId!: string;

  @OneToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'approved_plan_id', type: 'uuid', nullable: true })
  approvedPlanId!: string | null;

  @ManyToOne(() => ProjectPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_plan_id' })
  approvedPlan!: ProjectPlan | null;

  @Column({ type: 'jsonb', nullable: true })
  architecture!: Record<string, unknown> | null;

  @Column({ name: 'design_system', type: 'jsonb', nullable: true })
  designSystem!: Record<string, unknown> | null;

  @Column({ name: 'api_contract', type: 'jsonb', nullable: true })
  apiContract!: Record<string, unknown> | null;

  @Column({ name: 'data_model', type: 'jsonb', nullable: true })
  dataModel!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  conventions!: Record<string, unknown> | null;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approvedByUser!: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
