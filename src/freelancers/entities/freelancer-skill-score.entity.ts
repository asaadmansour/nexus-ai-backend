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
import { FreelancerAssessment } from './freelancer-assessment.entity';
import { FreelancerProfile } from './freelancer-profile.entity';

@Entity('freelancer_skill_scores')
@Index(
  'freelancer_skill_scores_profile_skill_uidx',
  ['freelancerProfileId', 'skill'],
  {
    unique: true,
  },
)
@Index('freelancer_skill_scores_user_score_idx', ['userId', 'score'])
export class FreelancerSkillScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId: string;

  @ManyToOne(() => FreelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'freelancer_profile_id' })
  freelancerProfile: FreelancerProfile;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'assessment_id', type: 'uuid', nullable: true })
  assessmentId: string | null;

  @ManyToOne(() => FreelancerAssessment, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'assessment_id' })
  assessment: FreelancerAssessment | null;

  @Column({ type: 'varchar', length: 120 })
  skill: string;

  @Column({ type: 'numeric', precision: 3, scale: 2 })
  score: string;

  @Column({ type: 'numeric', precision: 3, scale: 2, nullable: true })
  confidence: string | null;

  @Column({ type: 'text', nullable: true })
  evidence: string | null;

  @Column({ type: 'varchar', length: 40, default: 'assessment' })
  source: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
