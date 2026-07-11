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
import { Brief } from './brief.entity';

@Entity('brief_embeddings')
@Index('brief_embeddings_brief_id_idx', ['briefId'])
@Index('brief_embeddings_brief_id_model_uidx', ['briefId', 'embeddingModel'], {
  unique: true,
})
export class BriefEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'brief_id', type: 'uuid' })
  briefId: string;

  @ManyToOne(() => Brief, (brief) => brief.embeddings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'brief_id' })
  brief: Brief;

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
