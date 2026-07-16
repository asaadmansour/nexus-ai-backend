import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export const PROJECT_TASK_STATUSES = [
  'todo',
  'blocked',
  'in_progress',
  'review',
  'changes_requested',
  'done',
  'cancelled',
] as const;

export class UpdateTaskDto {
  @IsOptional()
  @IsIn(PROJECT_TASK_STATUSES)
  status?: (typeof PROJECT_TASK_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  assignedFreelancerProfileId?: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
