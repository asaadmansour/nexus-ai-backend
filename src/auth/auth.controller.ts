import {
  Body,
  Controller,
  Post,
  Headers,
  UseGuards,
  Get,
  Req,
  Request,
  Res,
  Query,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { Response, Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { SignUpUserDto } from './dtos/signup-user.dto';
import { LogInUserDto } from './dtos/login-user.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { CompleteSignupDto } from './dtos/complete-signup.dto';
import { VerifyEmailDto } from './dtos/verify-email.dto';
import { RedisService } from 'src/redis/redis.service';
import * as crypto from 'crypto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly redisService: RedisService,
  ) {}

  private setRefreshTokenCookie(res: Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Post('signup')
  async signup(
    @Body() newUser: SignUpUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, accessToken, refreshToken } =
      await this.authService.signup(newUser);
    this.setRefreshTokenCookie(res, refreshToken);
    return { status: 'success', user, accessToken };
  }

  @Post('login')
  async login(
    @Body() user: LogInUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(user);
    this.setRefreshTokenCookie(res, refreshToken);
    return { status: 'success', accessToken };
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(
    @Headers('authorization') authHeader: string,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or malformed authorization header',
      );
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException(
        'Missing token inside authorization header',
      );
    }

    const refreshToken = req.cookies['refreshToken'];
    if (refreshToken) {
      await this.authService.logout(token, refreshToken);
      res.clearCookie('refreshToken', { path: '/' });
    }
    return { status: 'logged out' };
  }

  @Post('refresh')
  async refresh(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const oldRefreshToken = req.cookies['refreshToken'];
    if (!oldRefreshToken)
      throw new UnauthorizedException('No refresh token provided');

    const { accessToken, refreshToken } =
      await this.authService.refresh(oldRefreshToken);
    this.setRefreshTokenCookie(res, refreshToken);
    return { status: 'success', accessToken };
  }

  @Get('google')
  @UseGuards(PassportAuthGuard('google'))
  async googleAuth(@Req() req: any) {
    // initiates the Google OAuth2 login flow
  }

  @Get('google/callback')
  @UseGuards(PassportAuthGuard('google'))
  async googleAuthRedirect(@Req() req: any, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    try {
      const { accessToken, refreshToken, isProfileComplete } =
        await this.authService.googleLogin(req.user);

      const exchangeCode = crypto.randomBytes(32).toString('hex');
      await this.redisService.set(
        `auth:exchange:${exchangeCode}`,
        JSON.stringify({ accessToken, refreshToken, isProfileComplete }),
        300,
      ); // 5 min TTL

      res.redirect(`${frontendUrl}/auth-callback#code=${exchangeCode}`);
    } catch (error) {
      this.logger.error('Google OAuth callback failed', error);
      res.redirect(`${frontendUrl}/auth-callback?error=login_failed`);
    }
  }

  @Post('exchange')
  async exchangeCode(
    @Body('code') code: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!code) throw new BadRequestException('Exchange code is required');
    const dataStr = await this.redisService.getDel(`auth:exchange:${code}`);
    if (!dataStr)
      throw new BadRequestException('Invalid or expired exchange code');
    let parsedData;
    try {
      parsedData = JSON.parse(dataStr);
    } catch {
      throw new BadRequestException('Invalid exchange code format');
    }
    const { accessToken, refreshToken, isProfileComplete } = parsedData;

    this.setRefreshTokenCookie(res, refreshToken);
    return { status: 'success', accessToken, isProfileComplete };
  }

  @UseGuards(AuthGuard)
  @Post('complete-profile')
  async completeSignup(
    @Request() req: any,
    @Body() body: CompleteSignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.completeSignup(req.user.sub, body);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return {
      status: 'success',
      user: result.user,
      accessToken: result.accessToken,
    };
  }

  @UseGuards(AuthGuard)
  @Post('resend-verification')
  async sendVerificationEmail(@Request() req: any) {
    return await this.authService.sendVerificationEmail(req.user.sub);
  }

  @UseGuards(AuthGuard)
  @Post('verify-email')
  async verifyEmail(
    @Request() req: any,
    @Body() body: VerifyEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyEmail(req.user.sub, body.code);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return { status: 'success', accessToken: result.accessToken };
  }
}
