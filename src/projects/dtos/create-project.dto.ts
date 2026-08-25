import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsIn,
  IsPositive,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsLesserThanOrEqual } from 'src/common/decorators/is-lesser-than-or-equal.decorator';
import { IsFutureDate } from 'src/common/decorators/is-future-date.decorator';

/** Currencies the platform actually supports — mirrors the UI dropdown. */
export const SUPPORTED_CURRENCIES = ['EGP', 'USD', 'EUR'] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProjectDto {
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @Matches(/\S/, { message: 'title must contain non-whitespace characters' })
  @MaxLength(255)
  title: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @Matches(/\S/, {
    message: 'description must contain non-whitespace characters',
  })
  @MaxLength(2000)
  description: string;

  @IsNumber()
  @Min(0)
  @IsLesserThanOrEqual('budgetMax')
  budgetMin: number;

  @IsNumber()
  @IsPositive({ message: 'budgetMax must be greater than 0' })
  budgetMax: number;

  @IsString()
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(SUPPORTED_CURRENCIES, {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency?: string;

  @IsDateString()
  @IsOptional()
  @IsFutureDate()
  deadline?: string;

  @IsBoolean()
  @IsOptional()
  isDeadlineFlexible?: boolean;
}
