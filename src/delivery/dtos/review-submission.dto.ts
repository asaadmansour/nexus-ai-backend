import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ReviewSubmissionDto {
  @IsIn(['approved', 'changes_requested', 'rejected'])
  decision!: 'approved' | 'changes_requested' | 'rejected';

  @IsOptional()
  @IsString()
  feedback?: string;

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
