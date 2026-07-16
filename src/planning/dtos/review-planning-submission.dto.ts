import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewPlanningSubmissionDto {
  @IsIn(['approved', 'changes_requested', 'rejected'])
  status!: 'approved' | 'changes_requested' | 'rejected';

  @IsOptional()
  @IsString()
  adminNotes?: string;
}
