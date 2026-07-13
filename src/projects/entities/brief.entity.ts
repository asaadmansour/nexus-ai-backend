import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BriefEmbedding } from './brief-embedding.entity';
import { Project } from './project.entity';

@Entity('briefs')
export class Brief {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid', unique: true })
  projectId: string;

  @OneToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @OneToMany(() => BriefEmbedding, (embedding) => embedding.brief)
  embeddings?: BriefEmbedding[];

  @Column({ name: 'is_complete', type: 'boolean', default: false })
  isComplete: boolean;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({
    name: 'client_background',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  clientBackground: string | null;

  @Column({ name: 'ai_decides_stack', type: 'boolean', default: false })
  aiDecidesStack: boolean;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({
    name: 'project_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  projectType: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  domain: string | null;

  @Column({ name: 'main_goal', type: 'text', nullable: true })
  mainGoal: string | null;

  @Column({ name: 'target_users', type: 'text', nullable: true })
  targetUsers: string | null;

  @Column({ name: 'core_features', type: 'text', nullable: true })
  coreFeatures: string | null;

  @Column({ type: 'text', nullable: true })
  platforms: string | null;

  @Column({ type: 'text', nullable: true })
  budget: string | null;

  @Column({ name: 'deadline_text', type: 'text', nullable: true })
  deadlineText: string | null;

  @Column({ name: 'deliverables_text', type: 'text', nullable: true })
  deliverablesText: string | null;

  @Column({ name: 'constraints_preferences', type: 'text', nullable: true })
  constraintsPreferences: string | null;

  @Column({ type: 'jsonb', nullable: true })
  technical: Record<string, unknown> | null;

  @Column({ name: 'non_functional', type: 'jsonb', nullable: true })
  nonFunctional: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  deliverables: Record<string, unknown> | null;

  @Column({ name: 'suggested_team_size', type: 'int', nullable: true })
  suggestedTeamSize: number | null;

  @Column({ name: 'preferred_timeline', type: 'interval', nullable: true })
  preferredTimeline: string | null;

  @Column({ name: 'is_deadline_flexible', type: 'boolean', default: false })
  isDeadlineFlexible: boolean;

  @Column({ name: 'deadline_date', type: 'date', nullable: true })
  deadlineDate: string | null;

  @Column({ name: 'required_skills', type: 'text', nullable: true })
  requiredSkills: string | null;

  @Column({ name: 'preferred_skills', type: 'text', nullable: true })
  preferredSkills: string | null;

  @Column({
    name: 'experience_level',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  experienceLevel: string | null;

  @Column({ name: 'experience_min_years', type: 'int', nullable: true })
  experienceMinYears: number | null;

  @Column({ name: 'missing_fields', type: 'text', array: true, default: '{}' })
  missingFields: string[];

  @Column({ name: 'completion_percentage', type: 'int', default: 0 })
  completionPercentage: number;

  @Column({ name: 'ai_revision_open', type: 'boolean', default: false })
  aiRevisionOpen: boolean;

  @Column({ name: 'revision_count', type: 'int', default: 0 })
  revisionCount: number;

  @Column({ name: 'revision_limit', type: 'int', default: 3 })
  revisionLimit: number;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true })
  confirmedBy: string | null;

  @Column({ name: 'manually_edited_at', type: 'timestamptz', nullable: true })
  manuallyEditedAt: Date | null;

  @Column({ name: 'reopened_at', type: 'timestamptz', nullable: true })
  reopenedAt: Date | null;

  @Column({
    name: 'pending_field',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  pendingField: string | null;

  @Column({
    name: 'next_question_field',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  nextQuestionField: string | null;

  @Column({
    name: 'extraction_source',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  extractionSource: string | null;

  @Column({ name: 'ai_source', type: 'varchar', length: 40, nullable: true })
  aiSource: string | null;

  @Column({ name: 'extracted_fields', type: 'jsonb', nullable: true })
  extractedFields: Record<string, unknown> | null;

  @Column({ name: 'ai_decided', type: 'jsonb', nullable: true })
  aiDecided: Record<string, unknown> | null;

  @Column({ name: 'acceptance_criteria', type: 'jsonb', nullable: true })
  acceptanceCriteria: Record<string, unknown> | null;

  @Column({ name: 'brief_text', type: 'text', nullable: true })
  briefText: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
