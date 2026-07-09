import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FreelancerAssessment } from './freelancer-assessment.entity';

@Entity('freelancer_assessment_questions')
export class FreelancerAssessmentQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assessment_id', type: 'uuid' })
  assessmentId: string;

  @ManyToOne(() => FreelancerAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessment_id' })
  assessment: FreelancerAssessment;

  @Column({ name: 'question_type', type: 'varchar', length: 40 })
  questionType: string;

  @Column({ type: 'text', nullable: true })
  skill: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  difficulty: string | null;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', nullable: true })
  choices: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true, select: false })
  rubric: Record<string, unknown> | null;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
