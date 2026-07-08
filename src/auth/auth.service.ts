import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { User } from 'src/users/entities/user.entity';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { SignUpUserDto } from './dtos/signup-user.dto';
import { JwtService } from '@nestjs/jwt';
import { LogInUserDto } from './dtos/login-user.dto';
import { RedisService } from 'src/redis/redis.service';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  private readonly saltOrRounds = 10;
  private readonly REFRESH_TOKEN_EXPIRY = '7d';
  private readonly REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  private async generateTokens(
    userId: string,
    queryRunner: QueryRunner,
    email?: string,
  ) {
    const accessToken = this.jwtService.sign({
      sub: userId,
      ...(email && { email }),
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
    await queryRunner.manager.save(refreshTokenEntity);
    return { accessToken, refreshToken };
  }

  async signup(newUser: SignUpUserDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const existing = await this.userRepository.findOne({
        where: { email: newUser.email },
      });
      if (existing) throw new BadRequestException('Duplicate Email');

      const { password, ...rest } = newUser;
      const hashedPassword = await bcrypt.hash(password, this.saltOrRounds);
      const user = this.userRepository.create({ ...rest, hashedPassword });
      const savedUser = await queryRunner.manager.save(user);

      const { accessToken, refreshToken } = await this.generateTokens(
        savedUser.id,
        queryRunner,
        savedUser.email,
      );
      await queryRunner.commitTransaction();
      return { user: savedUser, accessToken, refreshToken };
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
      const dbUser = await this.userRepository.findOne({
        where: { email: user.email },
        select: { hashedPassword: true, id: true, email: true },
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

      const storedToken = await this.refreshTokenRepository.findOne({
        where: { userId },
      });
      if (!storedToken) throw new UnauthorizedException('Invalid Token');

      const tokenMatch = await bcrypt.compare(refreshToken, storedToken.token);
      if (!tokenMatch) throw new UnauthorizedException('Invalid Token');

      await this.refreshTokenRepository.delete({ id: storedToken.id });

      const ttl = decodedAccess.exp - Math.floor(Date.now() / 1000);
      await this.redisService.set(accessToken, 'blacklisted', ttl);

      return { status: 'logged out' };
    } catch (error) {
      throw new UnauthorizedException('Invalid Token');
    }
  }

  async refresh(oldRefreshToken: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const { sub: userId } = this.jwtService.verify(oldRefreshToken);

      const storedToken = await this.refreshTokenRepository.findOne({
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

      const { accessToken, refreshToken } = await this.generateTokens(
        userId,
        queryRunner,
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
}
