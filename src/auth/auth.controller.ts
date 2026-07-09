import { Body, Controller, Post, Headers, UseGuards, Get, Req, Patch, Request, Res } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { SignUpUserDto } from './dtos/signup-user.dto';
import { LogInUserDto } from './dtos/login-user.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { LogoutUserDto } from './dtos/logout-user.dto';
import { CompleteSignupDto } from './dtos/complete-signup.dto';
import { VerifyEmailDto } from './dtos/verify-email.dto';

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

  @Get('google')
  @UseGuards(PassportAuthGuard('google'))
  async googleAuth(@Req() req: any) {
    // initiates the Google OAuth2 login flow
  }

  @Get('google/callback')
  @UseGuards(PassportAuthGuard('google'))
  async googleAuthRedirect(@Req() req: any, @Res() res: Response) {
    const { accessToken, refreshToken, isProfileComplete } = await this.authService.googleLogin(req.user);
    // Hardcoded fallback, in production use an environment variable FRONTEND_URL.
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth-callback?accessToken=${accessToken}&refreshToken=${refreshToken}&isProfileComplete=${isProfileComplete}`);
  }

  @UseGuards(AuthGuard)
  @Post('complete-profile')
  async completeSignup(@Request() req: any, @Body() body: CompleteSignupDto) {
    // The AuthGuard sets req.user to the payload of the JWT
    return await this.authService.completeSignup(req.user.sub, body);
  }

  @UseGuards(AuthGuard)
  @Post('resend-verification')
  async sendVerificationEmail(@Request() req: any) {
    return await this.authService.sendVerificationEmail(req.user.sub);
  }

  @UseGuards(AuthGuard)
  @Post('verify-email')
  async verifyEmail(@Request() req: any, @Body() body: VerifyEmailDto) {
    return await this.authService.verifyEmail(req.user.sub, body.code);
  }
}
