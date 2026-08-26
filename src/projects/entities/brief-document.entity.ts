import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Brief } from './brief.entity';

@Entity('brief_documents')
export class BriefDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'brief_id', type: 'uuid' })
  briefId: string;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid' })
  uploadedByUserId: string;

  @ManyToOne(() => Brief, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brief_id' })
  brief: Brief;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 30, default: 'processing' })
  status: string;

  @Column({ name: 'scan_status', type: 'varchar', length: 30 })
  scanStatus: string;

  @Column({ name: 'storage_public_id', type: 'varchar', length: 500 })
  storagePublicId: string;

  @Column({ name: 'storage_version', type: 'bigint' })
  storageVersion: string;

  @Column({ name: 'storage_format', type: 'varchar', length: 20 })
  storageFormat: string;

  @Column({ name: 'processing_attempts', type: 'int', default: 0 })
  processingAttempts: number;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ name: 'extracted_fields', type: 'jsonb', nullable: true })
  extractedFields: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'jsonb', nullable: true })
  warnings: string[] | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
