import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitSubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  summary?: string;
}
