import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { firstValueFrom, isObservable } from 'rxjs';

@Injectable()
export class GoogleOAuthCallbackGuard extends AuthGuard('google') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const activation = super.canActivate(context);
      if (isObservable(activation)) return firstValueFrom(activation);
      return await activation;
    } catch {
      const request = context.switchToHttp().getRequest<Request>();
      const response = context.switchToHttp().getResponse<Response>();
      const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
      const callbackUrl = new URL('/auth-callback', frontendUrl);
      callbackUrl.searchParams.set(
        'error',
        request.query.error === 'access_denied'
          ? 'access_denied'
          : 'oauth_failed',
      );
      response.redirect(callbackUrl.toString());
      return false;
    }
  }
}
