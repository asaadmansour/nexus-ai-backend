import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class GenerateAssessmentDto {
  @IsOptional()
  @IsUrl()
  cvUrl?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  skills!: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  yearsExperience?: number;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  questionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(7200)
  durationSeconds?: number;
}
