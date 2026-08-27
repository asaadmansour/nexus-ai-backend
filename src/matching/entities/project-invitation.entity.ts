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
import { Project } from '../../projects/entities/project.entity';
import { ProjectTask } from '../../projects/entities/project-task.entity';
import { MatchingCandidate } from './matching-candidate.entity';
import { MatchingRun } from './matching-run.entity';

@Entity('project_invitations')
@Index('project_invitations_user_status_idx', ['freelancerProfileId', 'status'])
@Index('project_invitations_expiry_idx', ['status', 'expiresAt'])
@Index('project_invitations_project_phase_idx', [
  'projectId',
  'phase',
  'status',
])
@Index('project_invitations_pending_run_uidx', ['matchingRunId'], {
  unique: true,
  where:
    '"matching_run_id" IS NOT NULL AND "status" IN (\'pending\', \'accepting\')',
})
@Index('project_invitations_pending_task_uidx', ['taskId'], {
  unique: true,
  where: '"task_id" IS NOT NULL AND "status" IN (\'pending\', \'accepting\')',
})
@Index(
  'project_invitations_active_role_uidx',
  ['projectId', 'phase', 'roleKey'],
  {
    unique: true,
    where: '"task_id" IS NULL AND "status" IN (\'pending\', \'accepting\')',
  },
)
export class ProjectInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @ManyToOne(() => ProjectTask, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: ProjectTask | null;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId!: string;

  @ManyToOne(() => FreelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile;

  @Column({ name: 'matching_run_id', type: 'uuid', nullable: true })
  matchingRunId!: string | null;

  @ManyToOne(() => MatchingRun, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'matching_run_id' })
  matchingRun!: MatchingRun | null;

  @Column({ name: 'candidate_id', type: 'uuid', nullable: true })
  candidateId!: string | null;

  @ManyToOne(() => MatchingCandidate, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'candidate_id' })
  candidate!: MatchingCandidate | null;

  @Column({ type: 'varchar', length: 40 })
  phase!: 'governance' | 'planning' | 'staffing' | 'implementation';

  @Column({ name: 'role_key', type: 'varchar', length: 80 })
  roleKey!: string;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status!: string;

  @Column({ name: 'rank_snapshot', type: 'int', nullable: true })
  rankSnapshot!: number | null;

  @Column({ name: 'score_snapshot', type: 'jsonb', nullable: true })
  scoreSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @Column({ name: 'response_reason', type: 'text', nullable: true })
  responseReason!: string | null;

  @Column({
    name: 'notification_status',
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  notificationStatus!: 'pending' | 'sending' | 'sent' | 'failed';

  @Column({ name: 'notification_attempts', type: 'int', default: 0 })
  notificationAttempts!: number;

  @Column({ name: 'notification_error', type: 'text', nullable: true })
  notificationError!: string | null;

  @Column({ name: 'notification_sent_at', type: 'timestamptz', nullable: true })
  notificationSentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
