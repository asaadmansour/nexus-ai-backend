import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FreelancerProfile } from '../../freelancers/entities/freelancer-profile.entity';
import { User } from '../../users/entities/user.entity';
import { Project } from './project.entity';

@Entity('project_ratings')
@Index(
  'project_ratings_project_rater_recipient_uidx',
  ['projectId', 'raterUserId', 'ratedUserId'],
  { unique: true },
)
@Index('project_ratings_profile_idx', ['freelancerProfileId'])
export class ProjectRating {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'rater_user_id', type: 'uuid' })
  raterUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rater_user_id' })
  raterUser!: User;

  @Column({ name: 'rated_user_id', type: 'uuid' })
  ratedUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rated_user_id' })
  ratedUser!: User;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId!: string;

  @ManyToOne(() => FreelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile!: FreelancerProfile;

  @Column({ name: 'role_keys', type: 'text', array: true, default: '{}' })
  roleKeys!: string[];

  @Column({ type: 'smallint' })
  rating!: number;

  @Column({ name: 'category_ratings', type: 'jsonb', nullable: true })
  categoryRatings!: Record<string, number> | null;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
