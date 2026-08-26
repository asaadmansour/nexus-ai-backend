import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ReviewPlanDto {
  @IsIn(['approved', 'changes_requested', 'rejected'])
  status!: 'approved' | 'changes_requested' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  adminNotes?: string;

  @IsOptional()
  @IsBoolean()
  materialize?: boolean;
}
