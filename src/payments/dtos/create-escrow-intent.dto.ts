import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

const PAYMENT_PURPOSES = [
  'planning_deposit',
  'milestone_funding',
  'full_project_deposit',
  'change_request',
  'refund_adjustment',
] as const;

export class CreateEscrowIntentDto {
  @IsNumber()
  @Min(1)
  amount!: number;

  @IsString()
  currency!: string;

  @IsOptional()
  @IsUUID()
  milestoneId?: string | null;

  @IsIn(PAYMENT_PURPOSES)
  purpose!: (typeof PAYMENT_PURPOSES)[number];
}
