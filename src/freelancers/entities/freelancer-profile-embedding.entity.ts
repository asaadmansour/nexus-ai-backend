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
import { FreelancerProfile } from './freelancer-profile.entity';

@Entity('freelancer_profile_embeddings')
@Index('freelancer_profile_embeddings_profile_id_idx', ['freelancerProfileId'])
@Index(
  'freelancer_profile_embeddings_profile_id_model_uidx',
  ['freelancerProfileId', 'embeddingModel'],
  { unique: true },
)
export class FreelancerProfileEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'freelancer_profile_id', type: 'uuid' })
  freelancerProfileId: string;

  @ManyToOne(() => FreelancerProfile, (profile) => profile.embeddings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'freelancer_profile_id' })
  profile: FreelancerProfile;

  @Column({ name: 'embedding_model', type: 'varchar', length: 100 })
  embeddingModel: string;

  @Column({ name: 'source_text', type: 'text' })
  sourceText: string;

  @Column({ name: 'dimensions', type: 'int', default: 1024 })
  dimensions: number;

  @Column({ type: 'vector', length: 1024, select: false })
  embedding: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
