import { ConflictException } from '@nestjs/common';
import { UserService } from './users.service';

describe('UserService profile phone verification', () => {
  const buildService = () => {
    const userRepository = {
      findOne: jest.fn(),
      save: jest.fn((user: Record<string, unknown>) => Promise.resolve(user)),
    };
    const configService = {
      get: jest.fn(
        (key: string) =>
          ({
            CLOUDINARY_CLOUD_NAME: 'test-cloud',
            CLOUDINARY_API_KEY: 'test-key',
            CLOUDINARY_API_SECRET: 'test-secret',
          })[key],
      ),
    };
    const service = new UserService(
      userRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      configService as never,
      {} as never,
    );
    return { service, userRepository };
  };

  it('revokes verification when a user changes their phone number', async () => {
    const { service, userRepository } = buildService();
    const user = {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phoneNumber: '+201000000000',
      isPhoneVerified: true,
      phoneVerifiedAt: new Date(),
    };
    userRepository.findOne
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(null);

    await expect(
      service.updateMe({ phoneNumber: '+201111111111' }, user.id),
    ).resolves.toEqual({
      status: 'updated successfully',
      requiresPhoneVerification: true,
    });
    expect(user).toMatchObject({
      phoneNumber: '+201111111111',
      isPhoneVerified: false,
      phoneVerifiedAt: null,
    });
    expect(userRepository.save).toHaveBeenCalledWith(user);
  });

  it('does not allow a phone number owned by another user', async () => {
    const { service, userRepository } = buildService();
    userRepository.findOne
      .mockResolvedValueOnce({
        id: 'user-1',
        phoneNumber: '+201000000000',
        isPhoneVerified: true,
      })
      .mockResolvedValueOnce({ id: 'user-2' });

    await expect(
      service.updateMe({ phoneNumber: '+201111111111' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(userRepository.save).not.toHaveBeenCalled();
  });
});
