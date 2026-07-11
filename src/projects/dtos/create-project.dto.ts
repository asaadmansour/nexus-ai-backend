import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsDateString,
  IsBoolean,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { IsLesserThanOrEqual } from 'src/common/decorators/is-lesser-than-or-equal.decorator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @IsNumber()
  @Min(0)
  @IsLesserThanOrEqual('budgetMax')
  budgetMin: number;

  @IsNumber()
  @Min(0)
  budgetMax: number;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, {
    message:
      'currency must be a valid ISO 4217 3-letter uppercase code (e.g. USD, EGP)',
  })
  currency?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsBoolean()
  @IsOptional()
  isDeadlineFlexible?: boolean;
}
