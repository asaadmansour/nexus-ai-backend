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
import { User } from '../../users/entities/user.entity';
import { RepositoryCollaborator } from './repository-collaborator.entity';
import { ProjectSubmission } from './project-submission.entity';
import { Project } from './project.entity';

@Entity('project_repositories')
@Index('project_repositories_project_status_idx', ['projectId', 'status'])
@Index(
  'project_repositories_provider_owner_repo_uidx',
  ['provider', 'owner', 'repoName'],
  {
    unique: true,
  },
)
export class ProjectRepository {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, (project) => project.repositories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ type: 'varchar', length: 40, default: 'github' })
  provider!: string;

  @Column({ type: 'varchar', length: 120 })
  owner!: string;

  @Column({ name: 'repo_name', type: 'varchar', length: 160 })
  repoName!: string;

  @Column({ name: 'repo_url', type: 'varchar', length: 500 })
  repoUrl!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 120, nullable: true })
  externalId!: string | null;

  @Column({
    name: 'installation_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  installationId!: string | null;

  @Column({
    name: 'default_branch',
    type: 'varchar',
    length: 120,
    default: 'main',
  })
  defaultBranch!: string;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status!: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser!: User | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @OneToMany(
    () => RepositoryCollaborator,
    (collaborator) => collaborator.repository,
  )
  collaborators?: RepositoryCollaborator[];

  @OneToMany(() => ProjectSubmission, (submission) => submission.repository)
  submissions?: ProjectSubmission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
