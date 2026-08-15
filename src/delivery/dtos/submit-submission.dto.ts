import { IsOptional, IsString } from 'class-validator';

export class SubmitSubmissionDto {
  @IsOptional()
  @IsString()
  summary?: string;
}
