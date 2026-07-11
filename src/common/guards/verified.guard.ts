import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user || user.isEmailVerified !== true) {
      throw new ForbiddenException(
        'You must verify your email address to perform this action',
      );
    }

    return true;
  }
}
