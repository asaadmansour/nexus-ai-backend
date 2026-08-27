import {
  IsIn,
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsNumber,
  IsBoolean,
  MaxLength,
  Min,
  Max,
  ArrayMaxSize,
  Matches,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  GITHUB_USERNAME_MAX_LENGTH,
  GITHUB_USERNAME_MESSAGE,
  GITHUB_USERNAME_PATTERN,
  normalizeGithubUsername,
} from 'src/common/validation/github-username';

export class UpdateFreelancerDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeGithubUsername(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(GITHUB_USERNAME_MAX_LENGTH)
  @Matches(GITHUB_USERNAME_PATTERN, { message: GITHUB_USERNAME_MESSAGE })
  githubUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  skills?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  yearsExperience?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  /** Unit for hourlyRate. Defaults to USD when never set. ISSUES.md #9. */
  @IsOptional()
  @IsIn(['EGP', 'USD', 'EUR', 'GBP'], {
    message: 'hourlyRateCurrency must be one of: EGP, USD, EUR, GBP',
  })
  hourlyRateCurrency?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  availabilityHoursPerWeek?: number;
}
