import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { PlanningMatchingFiltersDto } from './start-planning-matching.dto';

export class StartImplementationMatchingDto {
  // Both optional. Neither -> every unassigned matchable task. Both -> taskIds wins.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  taskIds?: string[];

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlanningMatchingFiltersDto)
  filters?: PlanningMatchingFiltersDto;

  @IsOptional()
  @IsIn(['sync', 'async'])
  mode?: 'sync' | 'async';
}
