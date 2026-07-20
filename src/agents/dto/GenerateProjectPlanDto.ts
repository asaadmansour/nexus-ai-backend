import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class GenerateProjectPlanDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  projectPlanJobId?: string;

  @IsObject()
  project!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  brief?: Record<string, unknown> | null;

  @IsObject()
  architectureSubmission!: Record<string, unknown>;

  @IsObject()
  uiuxSubmission!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  team?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  planningTeam?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  notes?: string;
}
