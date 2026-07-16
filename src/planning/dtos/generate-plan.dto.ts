import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

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
  notes?: string;
}
