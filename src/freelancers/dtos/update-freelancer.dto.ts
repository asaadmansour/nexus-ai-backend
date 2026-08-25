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
} from 'class-validator';

export class UpdateFreelancerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^(?!.*--)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, {
    message:
      'githubUsername may contain only letters, numbers, and single hyphens, with no leading or trailing hyphen',
  })
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
