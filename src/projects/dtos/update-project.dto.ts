import { IsEnum, IsString, IsNumber, IsOptional, IsDateString, IsBoolean, Min, MaxLength } from 'class-validator';
import { ProjectStatus } from 'src/common/enums/project-status.enum';

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetMin?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetMax?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsBoolean()
  @IsOptional()
  isDeadlineFlexible?: boolean;

  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;
}
