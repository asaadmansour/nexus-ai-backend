import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListSubmissionsDto {
  @IsOptional()
  @IsUUID('4')
  taskId?: string;

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsOptional()
  @IsIn([
    'draft',
    'submitted',
    'under_review',
    'changes_requested',
    'approved',
    'rejected',
    'superseded',
  ])
  status?: string;

  @IsOptional()
  @IsUUID('4')
  freelancerProfileId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
