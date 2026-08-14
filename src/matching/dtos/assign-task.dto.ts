import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AssignTaskDto {
  // One of candidateId / freelancerProfileId is required (checked in the service).
  @IsOptional()
  @IsUUID('4')
  candidateId?: string;

  @IsOptional()
  @IsUUID('4')
  freelancerProfileId?: string;

  @IsOptional()
  @IsUUID('4')
  sourceMatchingRunId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
