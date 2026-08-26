import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class QueueEvaluationDto {
  @IsOptional()
  @IsIn(['async', 'sync'])
  mode?: 'async' | 'sync';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
