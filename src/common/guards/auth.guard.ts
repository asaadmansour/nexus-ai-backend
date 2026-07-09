import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.headers.authorization)
      throw new UnauthorizedException('Invalid request');
    const [_, token] = request.headers.authorization.split(' ');

    try {
      const verifiedToken = this.jwtService.verify(token);
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
