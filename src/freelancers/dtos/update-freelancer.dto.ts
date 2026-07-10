import { IsString, IsOptional, IsArray, IsInt, IsNumber, IsBoolean, MaxLength, Min } from 'class-validator';

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
  @Min(0)
  yearsExperience?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
