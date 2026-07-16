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
}

export class MatchFreelancersDto {
  @IsOptional()
  @IsUUID()
  matchingRunId?: string;

  @IsIn(['architect', 'ui_ux'])
  targetRoleKey!: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchCandidateInputDto)
  candidates!: MatchCandidateInputDto[];
}
