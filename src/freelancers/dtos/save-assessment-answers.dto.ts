import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AssessmentAnswerItemDto {
  @IsUUID()
  questionId!: string;

  @IsObject()
  answer!: Record<string, unknown>;
}

export class SaveAssessmentAnswersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AssessmentAnswerItemDto)
  answers!: AssessmentAnswerItemDto[];

  @IsOptional()
  @IsBoolean()
  autosave?: boolean;
}
