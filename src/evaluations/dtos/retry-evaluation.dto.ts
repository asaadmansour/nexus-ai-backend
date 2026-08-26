import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RetryEvaluationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
