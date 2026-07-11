import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateBriefDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessDomain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  mainGoal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  targetUsers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  coreFeatures?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  platforms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliverables?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  constraintsPreferences?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientBackground?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  suggestedTeamSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  experienceLevel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  experienceMinYears?: number;
}
