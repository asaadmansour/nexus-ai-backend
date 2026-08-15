import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreatePaymentReleaseRequestDto {
  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsUUID('4')
  submissionId!: string;

  @IsOptional()
  @IsUUID('4')
  freelancerProfileId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
