import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCandidateStatusDto {
  @IsIn(['shortlisted', 'selected', 'rejected'])
  status!: 'shortlisted' | 'selected' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
