import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { FreelancerProfile } from './freelancer-profile.entity';

@Entity('freelancer_verification_events')
@Index('freelancer_verification_events_profile_created_idx', [
  'freelancerProfileId',
  'createdAt',
])
@Index('freelancer_verification_events_user_created_idx', [
  'userId',
  'createdAt',
])
@Index('freelancer_verification_events_type_created_idx', [
  'eventType',
  'createdAt',
])
export class FreelancerVerificationEvent {
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

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType: string;

  @Column({ name: 'from_status', type: 'varchar', length: 40, nullable: true })
  fromStatus: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 40, nullable: true })
  toStatus: string | null;

  @Column({
    name: 'actor_type',
    type: 'varchar',
    length: 30,
    default: 'system',
  })
  actorType: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
