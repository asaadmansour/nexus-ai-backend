import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

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
  decisionReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
