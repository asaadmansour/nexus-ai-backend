import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRoleAssignmentDto {
  @IsIn(['planning', 'implementation'])
  phase!: 'planning' | 'implementation';

  @IsIn(['architect', 'ui_ux'])
  roleKey!: 'architect' | 'ui_ux';

  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @IsOptional()
  @IsUUID()
  freelancerProfileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
