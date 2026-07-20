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
import { MatchingCandidate } from '../../matching/entities/matching-candidate.entity';
import { MatchingRun } from '../../matching/entities/matching-run.entity';
import { User } from '../../users/entities/user.entity';
import { Project } from './project.entity';

@Entity('project_role_assignments')
@Index('project_role_assignments_project_phase_status_idx', [
  'projectId',
  'phase',
  'status',
])
@Index(
  'project_role_assignments_freelancer_status_idx',
  ['freelancerProfileId', 'status'],
  {
    where: '"freelancer_profile_id" IS NOT NULL',
  },
)
@Index(
  'project_role_assignments_active_role_uidx',
  ['projectId', 'phase', 'roleKey'],
  {
    unique: true,
    where:
      "\"ended_at\" IS NULL AND \"status\" IN ('assigned', 'accepted', 'in_progress', 'completed')",
  },
)
export class ProjectRoleAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.roleAssignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'freelancer_profile_id', type: 'uuid', nullable: true })
  freelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile | null;

  @Column({ type: 'varchar', length: 40 })
  phase!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 80 })
  roleKey!: string;

  @Column({ type: 'varchar', length: 40, default: 'assigned' })
  status!: string;

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

  @Column({
    name: 'hourly_rate_snapshot',
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  hourlyRateSnapshot!: string | null;

  @Column({ name: 'availability_hours_snapshot', type: 'int', nullable: true })
  availabilityHoursSnapshot!: number | null;

  @Column({ name: 'score_snapshot', type: 'jsonb', nullable: true })
  scoreSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'decision_reason', type: 'text', nullable: true })
  decisionReason!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'role_brief', type: 'jsonb', nullable: true })
  roleBrief!: Record<string, unknown> | null;

  @Column({
    name: 'role_brief_status',
    type: 'varchar',
    length: 40,
    default: 'pending',
  })
  roleBriefStatus!: string;

  @Column({ name: 'role_brief_generated_at', type: 'timestamptz', nullable: true })
  roleBriefGeneratedAt!: Date | null;

  @Column({ name: 'role_brief_error', type: 'text', nullable: true })
  roleBriefError!: string | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'declined_at', type: 'timestamptz', nullable: true })
  declinedAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
