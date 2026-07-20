import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class GenerateRoleBriefDto {
  @IsUUID()
  assignmentId!: string;

  @IsString()
  roleKey!: string;

  @IsObject()
  project!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  brief?: Record<string, unknown> | null;

  @IsArray()
  standardExpectations!: string[];

  @IsOptional()
  @IsObject()
  freelancer?: Record<string, unknown> | null;
}
