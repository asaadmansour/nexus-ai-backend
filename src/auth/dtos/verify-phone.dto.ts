import { IsString, Length, Matches } from 'class-validator';

export class VerifyPhoneDto {
  @IsString()
  @Length(4, 10)
  @Matches(/^\d+$/)
  code!: string;
}
