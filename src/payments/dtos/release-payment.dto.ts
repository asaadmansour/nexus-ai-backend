import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ReleasePaymentDto {
  @IsOptional()
  @IsUUID()
  freelancerProfileId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
