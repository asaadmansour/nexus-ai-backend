import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProjectTask } from './project-task.entity';

@Entity('project_task_dependencies')
@Index('project_task_dependencies_pair_uidx', ['taskId', 'dependsOnTaskId'], {
  unique: true,
})
export class ProjectTaskDependency {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @ManyToOne(() => ProjectTask, (task) => task.dependencies, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'task_id' })
  task!: ProjectTask;

  @Column({ name: 'depends_on_task_id', type: 'uuid' })
  dependsOnTaskId!: string;

  @ManyToOne(() => ProjectTask, (task) => task.dependents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'depends_on_task_id' })
  dependsOnTask!: ProjectTask;

  @Column({ type: 'varchar', length: 40, default: 'blocks' })
  dependencyType!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
