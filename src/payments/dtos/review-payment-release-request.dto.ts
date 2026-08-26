import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReviewPaymentReleaseRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reviewNotes?: string;

  @IsOptional()
  @IsBoolean()
  releaseNow?: boolean;
}
