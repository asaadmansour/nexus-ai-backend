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
import { ProjectTask } from '../../projects/entities/project-task.entity';
import { Project } from '../../projects/entities/project.entity';
import { User } from '../../users/entities/user.entity';
import { MatchingCandidate } from './matching-candidate.entity';

@Entity('matching_runs')
@Index('matching_runs_project_status_idx', ['projectId', 'status'])
@Index('matching_runs_target_role_idx', [
  'projectId',
  'targetType',
  'targetRoleKey',
])
export class MatchingRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'target_type', type: 'varchar', length: 40 })
  targetType!: string;

  @Column({
    name: 'target_role_key',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  targetRoleKey!: string | null;

  @Column({ name: 'target_task_id', type: 'uuid', nullable: true })
  targetTaskId!: string | null;

  @ManyToOne(() => ProjectTask, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'target_task_id' })
  targetTask!: ProjectTask | null;

  @Column({ type: 'varchar', length: 40, default: 'queued' })
  status!: string;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by' })
  requestedByUser!: User | null;

  @Column({ type: 'jsonb', nullable: true })
  filters!: Record<string, unknown> | null;

  @Column({ name: 'input_snapshot', type: 'jsonb', nullable: true })
  inputSnapshot!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedByUser!: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @OneToMany(() => MatchingCandidate, (candidate) => candidate.matchingRun)
  candidates?: MatchingCandidate[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
