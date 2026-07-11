import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { IsEnum, IsNotIn, IsOptional } from 'class-validator';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @IsOptional()
  @IsNotIn([null], { message: 'budgetMin must not be null' })
  declare budgetMin?: number;

  @IsOptional()
  @IsNotIn([null], { message: 'budgetMax must not be null' })
  declare budgetMax?: number;

  @IsOptional()
  @IsNotIn([null], { message: 'title must not be null' })
  declare title?: string;

  @IsOptional()
  @IsNotIn([null], { message: 'currency must not be null' })
  declare currency?: string;
}
