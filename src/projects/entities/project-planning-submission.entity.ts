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
import { User } from '../../users/entities/user.entity';
import { ProjectRoleAssignment } from './project-role-assignment.entity';
import { Project } from './project.entity';

@Entity('project_planning_submissions')
@Index('project_planning_submissions_project_type_status_idx', [
  'projectId',
  'submissionType',
  'status',
])
@Index(
  'project_planning_submissions_assignment_type_version_uidx',
  ['assignmentId', 'submissionType', 'version'],
  {
    unique: true,
    where: '"assignment_id" IS NOT NULL',
  },
)
export class ProjectPlanningSubmission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

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

  @Column({ name: 'submission_type', type: 'varchar', length: 40 })
  submissionType!: string;

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

  @Column({ name: 'admin_notes', type: 'text', nullable: true })
  adminNotes!: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedByUser!: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
