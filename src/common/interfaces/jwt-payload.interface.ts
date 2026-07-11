import { UserRole } from 'src/common/enums/user-role.enum';
import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email?: string;
  role: UserRole;
  isEmailVerified?: boolean;
  exp?: number;
  iat?: number;
}

export interface RefreshJwtPayload {
  sub: string;
  exp?: number;
  iat?: number;
}

export interface GoogleAuthUser {
  id: string;
  email: string;
  role: UserRole;
  phoneNumber: string | null;
  isEmailVerified: boolean;
}

export interface OptionalAuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

export interface GoogleAuthenticatedRequest extends Request {
  user: GoogleAuthUser;
}
