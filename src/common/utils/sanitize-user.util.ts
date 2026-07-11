import { User } from 'src/users/entities/user.entity';

export function sanitizeUser(user: User): Partial<User>;
export function sanitizeUser(user: null): null;
export function sanitizeUser(user: undefined): undefined;
export function sanitizeUser(user: User | null | undefined) {
  if (user == null) return user;

  const safeUser: Partial<User> = { ...user };
  delete safeUser.hashedPassword;
  return safeUser;
}
