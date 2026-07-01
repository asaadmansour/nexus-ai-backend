import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('freelancer_profiles')
export class FreelancerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.freelancerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'cv_url', type: 'text', nullable: true })
  cvUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  // pgvector column. Queried via raw SQL / vector operators; TypeORM maps it as a string.
  @Column({ type: 'vector', nullable: true, select: false })
  embedding: string | null;

  @Column({ name: 'hourly_rate', type: 'numeric', precision: 8, scale: 2, nullable: true })
  hourlyRate: string | null;

  @Column({ name: 'last_interview_at', type: 'timestamptz', nullable: true })
  lastInterviewAt: Date | null;

  @Column({ name: 'interview_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  interviewScore: string | null;

  @Index('freelancer_profiles_is_available_idx')
  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable: boolean;

  @Column({ name: 'avg_rating', type: 'numeric', precision: 3, scale: 2, nullable: true })
  avgRating: string | null;

  @Column({ name: 'ratings_count', type: 'int', default: 0 })
  ratingsCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
