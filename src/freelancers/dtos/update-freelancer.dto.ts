import { IsString, IsOptional, IsArray, IsInt, IsNumber, IsBoolean, MaxLength } from 'class-validator';

export class UpdateFreelancerDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  headline?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsInt()
  yearsExperience?: number;

  @IsOptional()
  @IsNumber()
  hourlyRate?: number;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
