import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueueEvaluationDto {
  @IsOptional()
  @IsIn(['async', 'sync'])
  mode?: 'async' | 'sync';

  @IsOptional()
  @IsString()
  reason?: string;
}
