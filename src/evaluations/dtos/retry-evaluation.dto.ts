import { IsOptional, IsString } from 'class-validator';

export class RetryEvaluationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
