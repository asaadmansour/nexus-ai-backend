import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsFutureDate } from 'src/common/decorators/is-future-date.decorator';

export class CreateRevisionRequestDto {
  @IsOptional()
  @IsUUID('4')
  milestoneId?: string;

  @IsOptional()
  @IsUUID('4')
  taskId?: string;

  @IsOptional()
  @IsUUID('4')
  submissionId?: string;

  @IsOptional()
  @IsUUID('4')
  assignedToFreelancerProfileId?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  description?: string;

  @IsOptional()
  @IsObject()
  requestedChanges?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  @IsFutureDate()
  dueAt?: string;
}
