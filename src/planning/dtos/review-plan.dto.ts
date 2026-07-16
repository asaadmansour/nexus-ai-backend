import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ReviewPlanDto {
  @IsIn(['approved', 'changes_requested', 'rejected'])
  status!: 'approved' | 'changes_requested' | 'rejected';

  @IsOptional()
  @IsString()
  adminNotes?: string;

  @IsOptional()
  @IsBoolean()
  materialize?: boolean;
}
