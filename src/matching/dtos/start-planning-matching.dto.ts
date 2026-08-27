import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ArrayMaxSize,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

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
  @ArrayMaxSize(3)
  @Matches(/^(?:principal_reviewer|architect|ui_ux)$/, {
    each: true,
    message: 'each role must be principal_reviewer, architect, or ui_ux',
  })
  roles?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PlanningMatchingFiltersDto)
  filters?: PlanningMatchingFiltersDto;

  @IsOptional()
  @IsIn(['sync', 'async'])
  mode?: 'sync' | 'async';
}
