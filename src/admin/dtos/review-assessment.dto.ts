import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ReviewAssessmentDto {
  @IsIn(['pass', 'fail', 'needs_review'])
  decision!: 'pass' | 'fail' | 'needs_review';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scoreOverride?: number;
}
