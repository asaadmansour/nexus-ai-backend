import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  JwtPayload,
  OptionalAuthenticatedRequest,
} from 'src/common/interfaces/jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<OptionalAuthenticatedRequest>();
    return request.user;
  },
);
