import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ContainsOnlySafeUrls } from 'src/common/validation/contains-only-safe-urls.decorator';

export const SUBMISSION_TYPES = [
  'pull_request',
  'repository',
  'file',
  'text',
  'figma',
] as const;

export class CreateSubmissionDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsUUID('4')
  taskId!: string;

  @IsOptional()
  @IsUUID('4')
  repositoryId?: string;

  @IsIn(SUBMISSION_TYPES)
  submissionType!: (typeof SUBMISSION_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  summary?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  @ContainsOnlySafeUrls()
  fileUrls?: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(500)
  repoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  branchName?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(500)
  pullRequestUrl?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-fA-F0-9]{40}$/, {
    message: 'commitSha must be a full 40-character Git commit SHA',
  })
  commitSha?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['draft', 'submitted'])
  status?: 'draft' | 'submitted';
}
