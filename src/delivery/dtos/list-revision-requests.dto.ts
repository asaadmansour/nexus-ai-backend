import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListRevisionRequestsDto {
  @IsOptional()
  @IsIn(['open', 'in_progress', 'resolved', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsUUID('4')
  taskId?: string;

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsOptional()
  @IsUUID('4')
  assignedToFreelancerProfileId?: string;

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
