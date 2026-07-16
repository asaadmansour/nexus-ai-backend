import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePlanningSubmissionDto {
  @IsUUID()
  assignmentId!: string;

  @IsIn(['architecture', 'ui_ux'])
  submissionType!: 'architecture' | 'ui_ux';

  @IsOptional()
  @IsIn(['draft', 'submitted'])
  status?: 'draft' | 'submitted';

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  fileUrls?: Record<string, unknown>;
}
