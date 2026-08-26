import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRevisionStatusDto {
  @IsIn(['open', 'in_progress', 'resolved', 'cancelled'])
  status!: 'open' | 'in_progress' | 'resolved' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}
