import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @MaxLength(4000)
  evidence?: string;
}
