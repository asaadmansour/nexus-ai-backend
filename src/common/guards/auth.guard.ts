import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  JwtPayload,
  OptionalAuthenticatedRequest,
} from 'src/common/interfaces/jwt-payload.interface';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<OptionalAuthenticatedRequest>();
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedException('Invalid request');
    }
    const [, token] = authHeader.split(' ');
    if (!token) {
      throw new UnauthorizedException('Invalid request');
    }

    try {
      const verifiedToken = this.jwtService.verify<JwtPayload>(token);
      request.user = verifiedToken;
    } catch {
      throw new UnauthorizedException('Invalid request');
    }

    try {
      if ((await this.redisService.get(token)) === 'blacklisted')
        throw new UnauthorizedException('Invalid request');
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Service unavailable');
    }

    return true;
  }
}
