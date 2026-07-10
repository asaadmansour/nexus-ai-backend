import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from 'src/users/entities/user.entity';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { SignUpUserDto } from './dtos/signup-user.dto';
import { JwtService } from '@nestjs/jwt';
import { LogInUserDto } from './dtos/login-user.dto';
import { RedisService } from 'src/redis/redis.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserRole } from 'src/common/enums/user-role.enum';
import { EmailService } from 'src/email/email.service';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
  ) {}

  private readonly saltOrRounds = 10;
  private readonly REFRESH_TOKEN_EXPIRY = '7d';
  private readonly REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  private async generateTokens(
    userId: string,
    queryRunner: QueryRunner,
    email?: string,
    role?: UserRole,
    isEmailVerified?: boolean,
  ) {
    const accessToken = this.jwtService.sign({
      sub: userId,
      ...(email && { email }),
      ...(role && { role }),
      ...(isEmailVerified !== undefined && { isEmailVerified }),
    });
    const refreshToken = this.jwtService.sign(
      { sub: userId },
      { expiresIn: this.REFRESH_TOKEN_EXPIRY },
    );
    const hashedRefreshToken = await bcrypt.hash(
      refreshToken,
      this.saltOrRounds,
    );
    const refreshTokenEntity = this.refreshTokenRepository.create({
      token: hashedRefreshToken,
      userId,
      expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_TTL_MS),
    });
    await queryRunner.manager.delete(RefreshToken, { userId });
    await queryRunner.manager.save(refreshTokenEntity);
    return { accessToken, refreshToken };
  }

  async signup(newUser: SignUpUserDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const existing = await queryRunner.manager.findOne(User, {
        where: { email: newUser.email },
      });
      if (existing) throw new BadRequestException('Duplicate Email');

      const { password, ...rest } = newUser;
      const hashedPassword = await bcrypt.hash(password, this.saltOrRounds);
      const user = this.userRepository.create({ ...rest, hashedPassword });
      const savedUser = await queryRunner.manager.save(user);
      const { hashedPassword: _, ...userResponse } = savedUser;

      const { accessToken, refreshToken } = await this.generateTokens(
        savedUser.id,
        queryRunner,
        savedUser.email,
        savedUser.role,
        savedUser.isEmailVerified,
      );
      await queryRunner.commitTransaction();
      return { user: userResponse, accessToken, refreshToken };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async login(user: LogInUserDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const dbUser = await queryRunner.manager.findOne(User, {
        where: { email: user.email },
        select: {
          hashedPassword: true,
          id: true,
          email: true,
          role: true,
          isEmailVerified: true,
        },
      });
      if (!dbUser || !dbUser.hashedPassword)
        throw new UnauthorizedException('Either email or password wrong');

      const passwordMatch = await bcrypt.compare(
        user.password,
        dbUser.hashedPassword,
      );
      if (!passwordMatch)
        throw new UnauthorizedException('Either email or password wrong');

      const { accessToken, refreshToken } = await this.generateTokens(
        dbUser.id,
        queryRunner,
        dbUser.email,
        dbUser.role,
        dbUser.isEmailVerified,
      );
      await queryRunner.commitTransaction();
      return { status: 'success', accessToken, refreshToken };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async logout(accessToken: string, refreshToken: string) {
    try {
      const decodedAccess = this.jwtService.verify(accessToken);
      const userId = decodedAccess.sub;

      const ttl = Math.max(
        1,
        decodedAccess.exp - Math.floor(Date.now() / 1000),
      );
      // Always blacklist the access token to prevent reuse
      await this.redisService.set(accessToken, 'blacklisted', ttl);

      // Only validate and revoke the refresh token if one was provided
      if (refreshToken) {
        const storedToken = await this.refreshTokenRepository.findOne({
          where: { userId },
        });
        if (storedToken) {
          const tokenMatch = await bcrypt.compare(
            refreshToken,
            storedToken.token,
          );
          if (tokenMatch) {
            await this.refreshTokenRepository.delete({ id: storedToken.id });
          }
        }
      }

      return { status: 'logged out' };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid Token');
    }
  }

  async refresh(oldRefreshToken: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const { sub: userId } = this.jwtService.verify(oldRefreshToken);

      const storedToken = await queryRunner.manager.findOne(RefreshToken, {
        where: { userId },
      });
      if (!storedToken) throw new UnauthorizedException('Login again');

      const tokenMatch = await bcrypt.compare(
        oldRefreshToken,
        storedToken.token,
      );
      if (!tokenMatch) throw new UnauthorizedException('Login again');

      if (storedToken.expiresAt < new Date())
        throw new UnauthorizedException('Login again');

      await queryRunner.manager.delete(RefreshToken, { id: storedToken.id });

      // fetch user to get role for new token
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
        select: { id: true, email: true, role: true, isEmailVerified: true },
      });
      if (!user) throw new UnauthorizedException('Login again');

      const { accessToken, refreshToken } = await this.generateTokens(
        userId,
        queryRunner,
        user.email,
        user.role,
        user.isEmailVerified,
      );
      await queryRunner.commitTransaction();
      return { status: 'success', accessToken, refreshToken };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async validateGoogleUser(profile: {
    email: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  }) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      let user = await queryRunner.manager.findOne(User, {
        where: { email: profile.email },
        select: {
          id: true,
          email: true,
          role: true,
          phoneNumber: true,
          isEmailVerified: true,
        },
      });

      if (!user) {
        user = this.userRepository.create({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          photoUrl: profile.photoUrl,
          hashedPassword: null,
          isEmailVerified: true,
        });
        user = await queryRunner.manager.save(user);
      } else if (!user.isEmailVerified) {
        user.isEmailVerified = true;
        user = await queryRunner.manager.save(user);
      }

      await queryRunner.commitTransaction();
      return user;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async googleLogin(reqUser: {
    id: string;
    email: string;
    role: UserRole;
    phoneNumber: string | null;
    isEmailVerified: boolean;
  }) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const { accessToken, refreshToken } = await this.generateTokens(
        reqUser.id,
        queryRunner,
        reqUser.email,
        reqUser.role,
        reqUser.isEmailVerified,
      );
      await queryRunner.commitTransaction();

      const isProfileComplete = reqUser.phoneNumber !== null;

      return {
        status: 'success',
        isProfileComplete,
        user: reqUser,
        accessToken,
        refreshToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async completeSignup(
    userId: string,
    payload: {
      phoneNumber: string;
      role: UserRole;
      firstName?: string;
      lastName?: string;
    },
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
      });
      if (!user) throw new BadRequestException('User not found');

      if (user.phoneNumber)
        throw new BadRequestException('Profile already complete');

      user.phoneNumber = payload.phoneNumber;
      user.role = payload.role;
      if (payload.firstName) user.firstName = payload.firstName;
      if (payload.lastName) user.lastName = payload.lastName;

      await queryRunner.manager.save(user);

      let freelancerProfile: FreelancerProfile | null = null;
      if (user.role === UserRole.FREELANCER) {
        freelancerProfile = queryRunner.manager.create(FreelancerProfile, {
          userId: user.id,
        });
        await queryRunner.manager.save(freelancerProfile);
      }

      const { accessToken, refreshToken } = await this.generateTokens(
        user.id,
        queryRunner,
        user.email,
        user.role,
        user.isEmailVerified,
      );

      await queryRunner.commitTransaction();

      const safeUser = Object.assign({}, user) as Partial<typeof user>;
      delete safeUser.hashedPassword;

      return {
        status: 'success',
        user: {
          ...safeUser,
          cvUrl: freelancerProfile?.cvUrl ?? null,
        },
        accessToken,
        refreshToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async sendVerificationEmail(userId: string) {
    // Atomic SET NX EX: only sets if key does NOT exist. Returns null if cooldown is active.
    const acquired = await this.redisService.setNx(
      `verifyEmailCooldown:${userId}`,
      'true',
      120,
    );
    if (!acquired) {
      throw new BadRequestException(
        'Code already sent recently. Please wait before retrying.',
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      await this.redisService.del(`verifyEmailCooldown:${userId}`);
      throw new BadRequestException('User not found');
    }
    if (user.isEmailVerified) {
      await this.redisService.del(`verifyEmailCooldown:${userId}`);
      throw new BadRequestException('Email is already verified');
    }

    // Generate a cryptographically sufficient 6-digit OTP
    const code = crypto.randomInt(100000, 1000000).toString();

    try {
      await this.emailService.sendVerificationEmail(user.email, code);
    } catch (emailError) {
      // Rollback cooldown lock if email fails so user can retry
      await this.redisService.del(`verifyEmailCooldown:${userId}`);
      throw emailError;
    }

    // Only store OTP after successful delivery
    await this.redisService.set(`verifyEmail:${userId}`, code, 900);

    return { status: 'success', message: 'Verification email sent' };
  }

  async verifyEmail(userId: string, code: string) {
    // Atomic INCR: returns new count; first call returns 1
    const storedCode = await this.redisService.get(`verifyEmail:${userId}`);
    if (!storedCode) {
      throw new BadRequestException('Verification code expired or invalid');
    }

    if (storedCode !== code) {
      // Atomically increment and apply TTL only on first increment
      const attempts = await this.redisService.incr(
        `verifyEmailAttempts:${userId}`,
        900,
      );
      if (attempts >= 3) {
        await this.redisService.del(`verifyEmail:${userId}`);
        await this.redisService.del(`verifyEmailAttempts:${userId}`);
        throw new BadRequestException(
          'Too many failed attempts. Please request a new code.',
        );
      }
      throw new BadRequestException('Invalid verification code');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const user = await queryRunner.manager.findOne(User, {
        where: { id: userId },
      });
      if (!user) throw new BadRequestException('User not found');
      if (user.isEmailVerified)
        throw new BadRequestException('Email is already verified');

      user.isEmailVerified = true;
      await queryRunner.manager.save(user);

      const { accessToken, refreshToken } = await this.generateTokens(
        user.id,
        queryRunner,
        user.email,
        user.role,
        user.isEmailVerified,
      );

      await queryRunner.commitTransaction();

      // Best-effort Redis cleanup — after commit, outside the transaction
      this.redisService
        .del(`verifyEmail:${userId}`)
        .catch((err) =>
          this.emailService['logger']?.error(
            `Failed to del verifyEmail key for ${userId}`,
            err,
          ),
        );
      this.redisService
        .del(`verifyEmailAttempts:${userId}`)
        .catch((err) =>
          this.emailService['logger']?.error(
            `Failed to del verifyEmailAttempts key for ${userId}`,
            err,
          ),
        );

      return { status: 'success', accessToken, refreshToken };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
