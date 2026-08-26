import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const PLANNING_ROLE_KEYS = ['architect', 'ui_ux'] as const;

export class PlanningMatchingFiltersDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9_999_999_999.99)
  maxHourlyRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  minAvailabilityHours?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  includeFreelancerIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
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
