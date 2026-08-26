import { ContainsOnlySafeUrls } from 'src/common/validation/contains-only-safe-urls.decorator';
import {
  MaxLength,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  summary?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  // Rendered as clickable links to reviewers, customers and admins, so only
  // absolute http(s) URLs may be stored here. ISSUES.md #29.
  @IsOptional()
  @IsObject()
  @ContainsOnlySafeUrls()
  fileUrls?: Record<string, unknown>;
}
