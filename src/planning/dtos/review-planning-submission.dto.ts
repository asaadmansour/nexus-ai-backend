import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ReviewPlanningSubmissionDto {
  @IsIn(['approved', 'changes_requested', 'rejected'])
  status!: 'approved' | 'changes_requested' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  adminNotes?: string;

  @IsOptional()
  @IsBoolean()
  aiOverride?: boolean;

  @ValidateIf((dto: ReviewPlanningSubmissionDto) => dto.aiOverride === true)
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  aiOverrideReason?: string;
}
