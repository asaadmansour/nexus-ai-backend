import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class MatchCandidateInputDto {
  @IsUUID()
  freelancerProfileId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  headline?: string;

  @IsOptional()
  @IsString()
  profileSummary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  skillScores?: { skill: string; score: number }[];

  @IsOptional()
  @IsNumber()
  hourlyRate?: number | null;

  @IsOptional()
  @IsNumber()
  availabilityHours?: number | null;

  @IsOptional()
  @IsNumber()
  yearsExperience?: number | null;

  @IsOptional()
  @IsNumber()
  averageSkillScore?: number | null;

  @IsOptional()
  @IsNumber()
  embeddingSimilarity?: number | null;

  @IsOptional()
  @IsInt()
  activeTaskCount?: number | null;

  @IsOptional()
  @IsInt()
  activeProjectCount?: number | null;

  @IsOptional()
  @IsNumber()
  performanceScore?: number | null;

  @IsOptional()
  @IsNumber()
  approvalRate?: number | null;

  @IsOptional()
  @IsNumber()
  onTimeRate?: number | null;

  @IsOptional()
  @IsInt()
  missedDeadlines?: number | null;

  @IsOptional()
  @IsInt()
  projectRemovals?: number | null;

  @IsOptional()
  @IsArray()
  riskFlags?: Record<string, unknown>[];
}

export class MatchFreelancersDto {
  @IsOptional()
  @IsUUID()
  matchingRunId?: string;

  @IsOptional()
  @IsIn(['planning_role', 'task'])
  targetType?: 'planning_role' | 'task';

  // Planning roles are 'architect' / 'ui_ux'; implementation tasks use the task
  // role key ('frontend', 'backend', ...), so this is a free-form string.
  @IsString()
  targetRoleKey!: string;

  @IsOptional()
  @IsUUID()
  targetTaskId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsObject()
  project!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  brief?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  task?: Record<string, unknown> | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchCandidateInputDto)
  candidates!: MatchCandidateInputDto[];
}
