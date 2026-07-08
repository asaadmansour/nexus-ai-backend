import { IsString } from 'class-validator';

export class LogoutUserDto {
  @IsString()
  refreshToken!: string;
}
