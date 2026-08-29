import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import {
  PROFESSIONAL_ROLES,
  SENIORITY_LEVELS,
  type ProfessionalRole,
  type SeniorityLevel,
} from '../../freelancers/professional-classification';

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
  @IsIn(PROFESSIONAL_ROLES)
  targetRole?: ProfessionalRole;

  @IsOptional()
  @IsIn(SENIORITY_LEVELS)
  targetSeniority?: SeniorityLevel;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  questionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(7200)
  durationSeconds?: number;
}
