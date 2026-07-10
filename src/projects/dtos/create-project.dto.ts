import { IsString, IsNotEmpty, IsNumber, IsOptional, IsDateString, IsBoolean, Min, MaxLength } from 'class-validator';
import { IsLesserThanOrEqual } from 'src/common/decorators/is-lesser-than-or-equal.decorator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
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
  @MaxLength(3)
  currency?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsBoolean()
  @IsOptional()
  isDeadlineFlexible?: boolean;
}
