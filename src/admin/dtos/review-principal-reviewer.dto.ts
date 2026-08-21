import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ReviewPrincipalReviewerDto {
  @IsIn(['approved', 'rejected', 'suspended'])
  status!: 'approved' | 'rejected' | 'suspended';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  hourlyRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  maxConcurrentProjects?: number;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
