import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateCandidateStatusDto {
  @IsIn(['shortlisted', 'selected', 'rejected'])
  status!: 'shortlisted' | 'selected' | 'rejected';

  @IsOptional()
  @IsString()
  reason?: string;
}
