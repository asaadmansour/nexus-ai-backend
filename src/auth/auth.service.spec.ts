import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserRole } from '../common/enums/user-role.enum';

describe('AuthService login', () => {
  it('returns a disabled-account error after valid credentials', async () => {
    const hashedPassword = await bcrypt.hash('correct-password', 4);
    const manager = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-id',
        email: 'disabled@example.com',
        role: UserRole.FREELANCER,
        hashedPassword,
        isEmailVerified: true,
        isPhoneVerified: true,
        deletedAt: new Date(),
      }),
    };
    const queryRunner = {
      manager,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { createQueryRunner: () => queryRunner } as never,
      {} as never,
    );

    await expect(
      service.login({
        email: 'disabled@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow(
      new ForbiddenException(
        'Your account is disabled. Contact support or an administrator.',
      ),
    );
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ withDeleted: true }),
    );
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
  });
});
