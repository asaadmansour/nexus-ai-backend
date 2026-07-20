import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { User } from '../../users/entities/user.entity';
import { EvaluationRun } from './evaluation-run.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { ProjectPlan } from './project-plan.entity';
import { ProjectRepository } from './project-repository.entity';
import { ProjectRevisionRequest } from './project-revision-request.entity';
import { ProjectRoleAssignment } from './project-role-assignment.entity';
import { ProjectSubmissionReview } from './project-submission-review.entity';
import { ProjectSubmission } from './project-submission.entity';
import { ProjectTask } from './project-task.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('projects_customer_id_idx')
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id' })
  customer: User;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'budget_min', type: 'numeric', precision: 12, scale: 2 })
  budgetMin: string;

  @Column({ name: 'budget_max', type: 'numeric', precision: 12, scale: 2 })
  budgetMax: string;

  @Column({ type: 'char', length: 3, default: 'EGP' })
  currency: string;

  @Column({
    name: 'held_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  heldAmount: string;

  @Column({
    name: 'released_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  releasedAmount: string;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @Column({ name: 'is_deadline_flexible', type: 'boolean', default: false })
  isDeadlineFlexible: boolean;

  @Index('projects_status_idx')
  @Column({
    type: 'enum',
    enum: ProjectStatus,
    enumName: 'project_status',
    default: ProjectStatus.DRAFT,
  })
  status: ProjectStatus;

  @Index('projects_planning_status_idx')
  @Column({
    name: 'planning_status',
    type: 'varchar',
    length: 40,
    default: 'not_started',
  })
  planningStatus: string;

  @Column({ name: 'planning_started_at', type: 'timestamptz', nullable: true })
  planningStartedAt: Date | null;

  @Column({
    name: 'planning_completed_at',
    type: 'timestamptz',
    nullable: true,
  })
  planningCompletedAt: Date | null;

  @Column({
    name: 'implementation_ready_at',
    type: 'timestamptz',
    nullable: true,
  })
  implementationReadyAt: Date | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({
    name: 'quoted_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  quotedAmount: string | null;

  @Column({ name: 'quoted_currency', type: 'char', length: 3, nullable: true })
  quotedCurrency: string | null;

  @Index('projects_quote_status_idx')
  @Column({ name: 'quote_status', type: 'varchar', length: 40, default: 'not_ready' })
  quoteStatus: string;

  @Column({ name: 'quote_generated_at', type: 'timestamptz', nullable: true })
  quoteGeneratedAt: Date | null;

  @Column({ name: 'quote_notes', type: 'text', nullable: true })
  quoteNotes: string | null;

  @OneToMany(() => ProjectRoleAssignment, (assignment) => assignment.project)
  roleAssignments?: ProjectRoleAssignment[];

  @OneToMany(() => ProjectPlan, (plan) => plan.project)
  plans?: ProjectPlan[];

  @OneToMany(() => ProjectMilestone, (milestone) => milestone.project)
  milestones?: ProjectMilestone[];

  @OneToMany(() => ProjectTask, (task) => task.project)
  tasks?: ProjectTask[];

  @OneToMany(() => ProjectSubmission, (submission) => submission.project)
  submissions?: ProjectSubmission[];

  @OneToMany(() => ProjectSubmissionReview, (review) => review.project)
  submissionReviews?: ProjectSubmissionReview[];

  @OneToMany(() => ProjectRevisionRequest, (request) => request.project)
  revisionRequests?: ProjectRevisionRequest[];

  @OneToMany(() => EvaluationRun, (run) => run.project)
  evaluationRuns?: EvaluationRun[];

  @OneToMany(() => ProjectRepository, (repository) => repository.project)
  repositories?: ProjectRepository[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
