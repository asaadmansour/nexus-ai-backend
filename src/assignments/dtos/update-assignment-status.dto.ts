import { IsIn, IsOptional, IsString } from 'class-validator';

export const ASSIGNMENT_STATUS_TRANSITIONS = [
  'accepted',
  'declined',
  'in_progress',
  'completed',
  'cancelled',
  'replaced',
] as const;

export class UpdateAssignmentStatusDto {
  @IsIn(ASSIGNMENT_STATUS_TRANSITIONS)
  status!: (typeof ASSIGNMENT_STATUS_TRANSITIONS)[number];

  @IsOptional()
  @IsString()
  notes?: string;
}
