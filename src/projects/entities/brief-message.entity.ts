import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Brief } from './brief.entity';

@Entity('brief_messages')
export class BriefMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'brief_id', type: 'uuid' })
  briefId: string;

  @ManyToOne(() => Brief, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brief_id' })
  brief: Brief;

  @Column({ name: 'sender_type', type: 'varchar', length: 30 })
  senderType: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
