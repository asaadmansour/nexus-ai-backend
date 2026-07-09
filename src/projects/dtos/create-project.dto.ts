import { IsString, IsNotEmpty, IsNumber, IsOptional, IsDateString, IsBoolean, Min, MaxLength } from 'class-validator';

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
  budgetMin: number;

  @IsNumber()
  @Min(0)
  budgetMax: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsBoolean()
  @IsOptional()
  isDeadlineFlexible?: boolean;
}
