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
import { User } from '../../users/entities/user.entity';
import { FreelancerProfile } from './freelancer-profile.entity';

@Entity('freelancer_cv_versions')
@Index(
  'freelancer_cv_versions_profile_version_uidx',
  ['freelancerProfileId', 'versionNumber'],
  { unique: true },
)
@Index(
  'freelancer_cv_versions_profile_hash_uidx',
  ['freelancerProfileId', 'fileSha256'],
  { unique: true },
)
@Index('freelancer_cv_versions_profile_created_idx', [
  'freelancerProfileId',
  'createdAt',
])
@Index('freelancer_cv_versions_status_idx', ['status'])
export class FreelancerCvVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId!: string;

  @ManyToOne(() => FreelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber!: number;

  @Column({ name: 'cv_url', type: 'text' })
  cvUrl!: string;

  @Column({ name: 'cloudinary_public_id', type: 'text', nullable: true })
  cloudinaryPublicId!: string | null;

  @Column({ name: 'file_sha256', type: 'char', length: 64 })
  fileSha256!: string;

  @Column({
    name: 'original_filename',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalFilename!: string | null;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize!: number | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'processing' })
  status!: string;

  @Column({
    name: 'extracted_skills',
    type: 'text',
    array: true,
    nullable: true,
  })
  extractedSkills!: string[] | null;

  @Column({ name: 'new_skills', type: 'text', array: true, nullable: true })
  newSkills!: string[] | null;

  @Column({
    name: 'retained_skills',
    type: 'text',
    array: true,
    nullable: true,
  })
  retainedSkills!: string[] | null;

  @Column({ name: 'removed_skills', type: 'text', array: true, nullable: true })
  removedSkills!: string[] | null;

  @Column({ name: 'extraction_error', type: 'text', nullable: true })
  extractionError!: string | null;

  @Column({ name: 'extracted_at', type: 'timestamptz', nullable: true })
  extractedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
