import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyPrincipalReviewerDto {
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  statement?: string;
}
