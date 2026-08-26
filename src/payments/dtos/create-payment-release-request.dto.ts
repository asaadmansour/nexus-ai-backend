import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  Max,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SUPPORTED_CURRENCIES } from 'src/projects/dtos/create-project.dto';

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
  @Max(9_999_999_999.99)
  amount!: number;

  @IsString()
  @Length(3, 3)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
