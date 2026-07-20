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
import { ProjectRepository } from './project-repository.entity';
import { ProjectRoleAssignment } from './project-role-assignment.entity';
import { Project } from './project.entity';

@Entity('repository_collaborators')
@Index('repository_collaborators_repo_status_idx', [
  'repositoryId',
  'inviteStatus',
])
@Index(
  'repository_collaborators_project_freelancer_idx',
  ['projectId', 'freelancerProfileId'],
  {
    where: '"freelancer_profile_id" IS NOT NULL',
  },
)
@Index(
  'repository_collaborators_repo_freelancer_uidx',
  ['repositoryId', 'freelancerProfileId'],
  {
    unique: true,
    where: '"freelancer_profile_id" IS NOT NULL',
  },
)
@Index(
  'repository_collaborators_repo_github_username_uidx',
  ['repositoryId', 'githubUsername'],
  {
    unique: true,
    where: '"github_username" IS NOT NULL',
  },
)
export class RepositoryCollaborator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId!: string;

  @ManyToOne(
    () => ProjectRepository,
    (repository) => repository.collaborators,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'repository_id' })
  repository!: ProjectRepository;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'freelancer_profile_id', type: 'uuid', nullable: true })
  freelancerProfileId!: string | null;

  @ManyToOne(() => FreelancerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile | null;

  @Column({ name: 'assignment_id', type: 'uuid', nullable: true })
  assignmentId!: string | null;

  @ManyToOne(() => ProjectRoleAssignment, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'assignment_id' })
  assignment!: ProjectRoleAssignment | null;

  @Column({
    name: 'github_username',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  githubUsername!: string | null;

  @Column({
    name: 'github_user_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  githubUserId!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'push' })
  permission!: string;

  @Column({
    name: 'invite_status',
    type: 'varchar',
    length: 40,
    default: 'pending',
  })
  inviteStatus!: string;

  @Column({ name: 'invite_url', type: 'varchar', length: 500, nullable: true })
  inviteUrl!: string | null;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt!: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
