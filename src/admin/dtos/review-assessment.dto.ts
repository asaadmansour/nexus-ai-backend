import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class ReviewAssessmentDto {
  @IsIn(['pass', 'fail', 'needs_review'])
  decision!: 'pass' | 'fail' | 'needs_review';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scoreOverride?: number;
}
