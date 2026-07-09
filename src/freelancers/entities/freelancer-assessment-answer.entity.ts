import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FreelancerAssessment } from './freelancer-assessment.entity';
import { FreelancerAssessmentQuestion } from './freelancer-assessment-question.entity';

@Entity('freelancer_assessment_answers')
export class FreelancerAssessmentAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assessment_id', type: 'uuid' })
  assessmentId: string;

  @ManyToOne(() => FreelancerAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessment_id' })
  assessment: FreelancerAssessment;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => FreelancerAssessmentQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: FreelancerAssessmentQuestion;

  @Column({ type: 'jsonb' })
  answer: Record<string, unknown>;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  score: string | null;

  @Column({ type: 'text', nullable: true })
  feedback: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
