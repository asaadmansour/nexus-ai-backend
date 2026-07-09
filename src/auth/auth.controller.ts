import { Body, Controller, Post, Headers, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpUserDto } from './dtos/signup-user.dto';
import { LogInUserDto } from './dtos/login-user.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { LogoutUserDto } from './dtos/logout-user.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(@Body() newUser: SignUpUserDto) {
    return await this.authService.signup(newUser);
  }

  @Post('login')
  async login(@Body() user: LogInUserDto) {
    return await this.authService.login(user);
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(
    @Headers('authorization') authHeader: string,
    @Body() body: LogoutUserDto,
  ) {
    const token = authHeader.split(' ')[1];
    return await this.authService.logout(token, body.refreshToken);
  }

  @Post('refresh')
  async refresh(@Body() refreshUser: RefreshTokenDto) {
    return await this.authService.refresh(refreshUser.refreshToken);
  }
}
