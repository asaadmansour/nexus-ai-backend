import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const allowedRoles = this.reflector.get('roles', context.getHandler());
    if (!allowedRoles) return true;
    const request = context.switchToHttp().getRequest();
    if (!allowedRoles.includes(request.user.role))
      throw new ForbiddenException('This action is not allowed for you');
    return true;
  }
}
