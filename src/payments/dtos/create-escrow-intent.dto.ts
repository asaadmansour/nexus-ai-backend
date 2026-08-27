import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SUPPORTED_CURRENCIES } from 'src/projects/dtos/create-project.dto';

const PAYMENT_PURPOSES = [
  'planning_deposit',
  'implementation_deposit',
  'milestone_funding',
  'full_project_deposit',
  'change_request',
  'refund_adjustment',
] as const;

export class CreateEscrowIntentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(9_999_999_999.99)
  amount!: number;

  @IsString()
  @MaxLength(3)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @IsOptional()
  @IsUUID()
  milestoneId?: string | null;

  @IsIn(PAYMENT_PURPOSES)
  purpose!: (typeof PAYMENT_PURPOSES)[number];
}
