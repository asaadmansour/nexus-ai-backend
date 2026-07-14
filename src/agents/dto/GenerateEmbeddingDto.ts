import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GenerateEmbeddingDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsInt()
  @Min(128)
  @Max(4096)
  dimensions?: number;

  @IsOptional()
  @IsString()
  model?: string;
}
