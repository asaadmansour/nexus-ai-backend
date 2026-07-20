import { IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CreateFreelancerOnboardingLinkDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  refreshUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  country?: string;
}
