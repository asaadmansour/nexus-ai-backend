import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListPaymentReleaseRequestsDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'released', 'failed', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsUUID('4')
  projectId?: string;

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

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
