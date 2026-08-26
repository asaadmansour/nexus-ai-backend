import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReviewRunDto {
  @IsIn(['approved', 'rejected', 'rerun_required'])
  decision!: 'approved' | 'rejected' | 'rerun_required';

  @IsOptional()
  @IsUUID()
  selectedCandidateId?: string;

  @IsOptional()
  @IsBoolean()
  createAssignment?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
