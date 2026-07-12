import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StartAssessmentDto {
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
