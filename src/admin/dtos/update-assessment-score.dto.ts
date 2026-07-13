import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateAssessmentScoreDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
