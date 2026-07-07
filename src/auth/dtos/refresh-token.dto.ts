import { IsEmail, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  userId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  refreshToken!: string;
}
