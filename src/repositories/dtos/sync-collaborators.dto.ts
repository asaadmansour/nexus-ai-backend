import { IsArray, IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export const COLLABORATOR_PERMISSIONS = [
  'pull',
  'triage',
  'push',
  'maintain',
  'admin',
] as const;

export class SyncCollaboratorsDto {
  // Defaults to true: the assignees of implementation tasks are the people who
  // need repository access.
  @IsOptional()
  @IsBoolean()
  includeTaskAssignees?: boolean;

  @IsOptional()
  @IsBoolean()
  includePlanningAssignees?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  freelancerProfileIds?: string[];

  @IsOptional()
  @IsIn(COLLABORATOR_PERMISSIONS)
  permission?: string;
}

export class ResendInviteDto {
  @IsOptional()
  @IsIn(COLLABORATOR_PERMISSIONS)
  permission?: string;
}
