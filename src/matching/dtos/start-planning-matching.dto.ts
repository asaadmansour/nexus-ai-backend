import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const PLANNING_ROLE_KEYS = ['architect', 'ui_ux'] as const;

export class PlanningMatchingFiltersDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxHourlyRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minAvailabilityHours?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  includeFreelancerIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  excludeFreelancerIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class StartPlanningMatchingDto {
  @IsOptional()
  @IsArray()
  @IsIn(PLANNING_ROLE_KEYS, { each: true })
  roles?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PlanningMatchingFiltersDto)
  filters?: PlanningMatchingFiltersDto;

  @IsOptional()
  @IsIn(['sync', 'async'])
  mode?: 'sync' | 'async';
}
