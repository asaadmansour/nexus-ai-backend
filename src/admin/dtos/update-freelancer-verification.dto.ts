import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFreelancerVerificationDto {
  @IsIn(['approved', 'rejected', 'interview_pending'])
  status!: 'approved' | 'rejected' | 'interview_pending';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reason?: string;
}
