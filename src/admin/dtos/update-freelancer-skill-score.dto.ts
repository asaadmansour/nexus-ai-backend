import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateFreelancerSkillScoreDto {
  @IsNumber()
  @Min(0)
  @Max(5)
  score!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  evidence?: string;
}
