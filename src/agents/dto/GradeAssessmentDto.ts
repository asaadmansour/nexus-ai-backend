import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class GradeAssessmentQuestionDto {
  @IsUUID()
  id!: string;

  @IsString()
  @IsNotEmpty()
  questionType!: string;

  @IsOptional()
  @IsString()
  skill?: string | null;

  @IsOptional()
  @IsString()
  difficulty?: string | null;

  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsOptional()
  @IsArray()
  choices?: unknown[] | null;

  @IsObject()
  rubric!: Record<string, unknown>;
}

export class GradeAssessmentAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsObject()
  @IsNotEmpty()
  answer!: Record<string, unknown>;
}

export class GradeAssessmentDto {
  @IsUUID()
  assessmentId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GradeAssessmentQuestionDto)
  questions!: GradeAssessmentQuestionDto[];

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GradeAssessmentAnswerDto)
  answers!: GradeAssessmentAnswerDto[];
}
