import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReleasePaymentDto {
  @IsOptional()
  @IsUUID()
  freelancerProfileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
