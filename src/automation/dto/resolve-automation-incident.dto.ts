import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveAutomationIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}
