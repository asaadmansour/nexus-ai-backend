import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { OptionalAuthenticatedRequest } from 'src/common/interfaces/jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const allowedRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles) return true;
    const request = context
      .switchToHttp()
      .getRequest<OptionalAuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('Not authenticated');
    if (!allowedRoles.includes(user.role))
      throw new ForbiddenException('This action is not allowed for you');
    return true;
  }
}
