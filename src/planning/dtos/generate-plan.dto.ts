import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class GeneratePlanDto {
  @IsOptional()
  @IsUUID()
  architectureSubmissionId?: string;

  @IsOptional()
  @IsUUID()
  uiuxSubmissionId?: string;

  @IsOptional()
  @IsIn(['sync', 'async'])
  mode?: 'sync' | 'async';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
