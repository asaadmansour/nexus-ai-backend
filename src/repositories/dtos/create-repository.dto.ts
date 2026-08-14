import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRepositoryDto {
  @IsOptional()
  @IsIn(['github'])
  provider?: string;

  // Defaults to GITHUB_OWNER.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  owner?: string;

  // Defaults to a slug of the project title.
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message:
      'repoName may contain only letters, numbers, dots, hyphens and underscores',
  })
  repoName?: string;

  @IsOptional()
  @IsIn(['private', 'public'])
  visibility?: 'private' | 'public';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  defaultBranch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(350)
  description?: string;
}
