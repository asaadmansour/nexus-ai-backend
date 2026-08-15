import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateRevisionStatusDto {
  @IsIn(['open', 'in_progress', 'resolved', 'cancelled'])
  status!: 'open' | 'in_progress' | 'resolved' | 'cancelled';

  @IsOptional()
  @IsString()
  notes?: string;
}
