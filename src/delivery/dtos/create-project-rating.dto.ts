import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProjectRatingDto {
  @IsUUID()
  ratedUserId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsObject()
  categoryRatings?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}
