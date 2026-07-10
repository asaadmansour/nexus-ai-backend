import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
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

  @Column({ name: 'is_complete', type: 'boolean', default: false })
  isComplete: boolean;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'raw_conversation', type: 'jsonb', nullable: true })
  rawConversation: Record<string, unknown> | null;

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

  @Column({ name: 'ai_decided', type: 'jsonb', nullable: true })
  aiDecided: Record<string, unknown> | null;

  @Column({ name: 'acceptance_criteria', type: 'jsonb', nullable: true })
  acceptanceCriteria: Record<string, unknown> | null;

  @Column({ name: 'brief_text', type: 'text', nullable: true })
  briefText: string | null;

  @Column({ type: 'text', nullable: true })
  embedding: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
