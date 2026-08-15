import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewPaymentReleaseRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reviewNotes?: string;

  @IsOptional()
  @IsBoolean()
  releaseNow?: boolean;
}
