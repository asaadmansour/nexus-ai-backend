import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateFreelancerVerificationDto {
  @IsIn(['approved', 'rejected', 'interview_pending'])
  status!: 'approved' | 'rejected' | 'interview_pending';

  @IsOptional()
  @IsString()
  reason?: string;
}