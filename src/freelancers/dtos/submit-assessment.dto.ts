import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { AssessmentAnswerItemDto } from './save-assessment-answers.dto';

export class SubmitAssessmentDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssessmentAnswerItemDto)
  finalAnswers?: AssessmentAnswerItemDto[];

  @IsOptional()
  @IsIn(['manual_submit', 'timer_expired'])
  reason?: 'manual_submit' | 'timer_expired';
}
