import { UserRole } from 'src/common/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  isEmailVerified?: boolean;
}
