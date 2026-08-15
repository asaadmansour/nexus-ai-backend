import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SUBMISSION_TYPES } from './create-submission.dto';

export class UpdateSubmissionDto {
  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsOptional()
  @IsUUID('4')
  repositoryId?: string;

  @IsOptional()
  @IsIn(SUBMISSION_TYPES)
  submissionType?: (typeof SUBMISSION_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
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

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  repoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  branchName?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  pullRequestUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  commitSha?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
