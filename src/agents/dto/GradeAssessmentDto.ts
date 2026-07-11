import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class GradeAssessmentAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsNotEmpty()
  answer!: unknown;
}

export class GradeAssessmentDto {
  @IsOptional()
  @IsUUID()
  assessmentId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GradeAssessmentAnswerDto)
  answers!: GradeAssessmentAnswerDto[];
}
