import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { ProjectTask } from '../../projects/entities/project-task.entity';
import { FreelancerProfile } from './freelancer-profile.entity';

@Entity('freelancer_performance_events')
@Index('freelancer_performance_events_profile_created_idx', [
  'freelancerProfileId',
  'createdAt',
])
export class FreelancerPerformanceEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId!: string;

  @ManyToOne(() => FreelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project!: Project | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => ProjectTask, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id' })
  task!: ProjectTask | null;

  @Column({ name: 'event_type', type: 'varchar', length: 60 })
  eventType!: string;

  @Column({
    name: 'score_delta',
    type: 'numeric',
    precision: 6,
    scale: 2,
    default: 0,
  })
  scoreDelta!: string;

  @Column({
    name: 'money_delta',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  moneyDelta!: string;

  @Column({ type: 'char', length: 3, nullable: true })
  currency!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
