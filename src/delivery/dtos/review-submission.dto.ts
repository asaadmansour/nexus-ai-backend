import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubmissionCriterionReviewDto {
  @IsString()
  @MaxLength(160)
  criterionKey!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}

export class ReviewSubmissionDto {
  @IsIn(['approved', 'changes_requested', 'rejected'])
  decision!: 'approved' | 'changes_requested' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  feedback?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SubmissionCriterionReviewDto)
  criteriaReviews?: SubmissionCriterionReviewDto[];

  @IsOptional()
  @IsObject()
  requestedChanges?: Record<string, unknown>;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsBoolean()
  createRevisionRequest?: boolean;

  @IsOptional()
  @IsBoolean()
  releasePayment?: boolean;

  @IsOptional()
  @IsBoolean()
  manualReviewAcknowledged?: boolean;
}
