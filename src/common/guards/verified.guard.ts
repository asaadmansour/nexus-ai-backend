import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user) throw new UnauthorizedException('Invalid request');
    const currentUser = await this.dataSource.getRepository(User).findOne({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isEmailVerified: true,
        isPhoneVerified: true,
      },
    });
    if (!currentUser) throw new UnauthorizedException('Invalid request');

    user.email = currentUser.email;
    user.role = currentUser.role;
    user.isEmailVerified = currentUser.isEmailVerified;
    user.isPhoneVerified = currentUser.isPhoneVerified;

    if (!currentUser.isEmailVerified) {
      throw new ForbiddenException(
        'You must verify your email address to perform this action',
      );
    }

    const phoneRequired =
      (process.env.PHONE_VERIFICATION_REQUIRED ??
        (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';
    if (phoneRequired && !currentUser.isPhoneVerified) {
      throw new ForbiddenException(
        'You must verify your phone number to perform this action',
      );
    }

    return true;
  }
}
