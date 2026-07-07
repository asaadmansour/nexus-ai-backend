import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';

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
  ) {}
  saltOrRounds: number = 10;

  async signup(newUser: SignUpUserDto) {
    const repeatedEmail = await this.userRepository.findOne({
      where: { email: newUser.email },
    });
    if (repeatedEmail) {
      throw new BadRequestException('Duplicate Email');
    }
    const { password, ...rest } = newUser;
    const hashedPassword = await bcrypt.hash(password, this.saltOrRounds);
    const user = this.userRepository.create({
      ...rest,
      hashedPassword: hashedPassword,
    });
    const addedUser = await this.userRepository.save(user);
    const access_token = this.jwtService.sign({
      sub: addedUser.id,
      email: addedUser.email,
    });
    const r_token = this.jwtService.sign(
      { sub: addedUser.id },
      { expiresIn: '7d' },
    );
    const r_token_hashed = await bcrypt.hash(r_token, this.saltOrRounds);
    const r_token_object = this.refreshTokenRepository.create({
      token: r_token_hashed,
      userId: addedUser.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const refresh_token =
      await this.refreshTokenRepository.save(r_token_object);
    return {
      newuser: addedUser,
      access_token: access_token,
      refresh_token: r_token,
    };
  }

  async login(user: LogInUserDto) {
    const dbUser = await this.userRepository.findOne({
      where: { email: user.email },
      select: { hashedPassword: true, id: true, email: true },
    });
    if (!dbUser || !dbUser.hashedPassword)
      throw new UnauthorizedException('Either email or password wrong');
    const existingUser = await bcrypt.compare(
      user.password,
      dbUser.hashedPassword,
    );
    if (!existingUser)
      throw new UnauthorizedException('Either email or password wrong');

    const access_token = this.jwtService.sign({
      sub: dbUser.id,
      email: dbUser.email,
    });

    const r_token = this.jwtService.sign(
      { sub: dbUser.id },
      { expiresIn: '7d' },
    );
    const r_token_hashed = await bcrypt.hash(r_token, this.saltOrRounds);
    const r_token_object = this.refreshTokenRepository.create({
      token: r_token_hashed,
      userId: dbUser.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const refresh_token =
      await this.refreshTokenRepository.save(r_token_object);
    return {
      status: 'success',
      access_token: access_token,
      refresh_token: r_token,
    };
  }

  async logout(token: string) {
    const decodedToken = this.jwtService.decode(token);
    const userId = decodedToken.sub;
    await this.refreshTokenRepository.delete({ userId: userId });
    await this.redisService.set(token, 'blacklisted', 10800);
    return {
      status: 'logged out',
    };
  }

  async refresh(refresh_token: string) {
    const { sub: userId } = this.jwtService.decode(refresh_token);
    const token_row = await this.refreshTokenRepository.findOne({
      where: { userId: userId },
    });
    if (!token_row) throw new UnauthorizedException('Login again');
    const correct_token = await bcrypt.compare(refresh_token, token_row.token);
    if (!correct_token) throw new UnauthorizedException('Login again');
    if (token_row?.expiresAt < new Date())
      throw new UnauthorizedException('Login again');
    await this.refreshTokenRepository.delete({ id: token_row?.id });
    const access_token = this.jwtService.sign({
      sub: userId,
    });
    const r_token = this.jwtService.sign({ sub: userId }, { expiresIn: '7d' });
    const r_token_hashed = await bcrypt.hash(r_token, this.saltOrRounds);
    const r_token_object = this.refreshTokenRepository.create({
      token: r_token_hashed,
      userId: userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const refresh_token_stored =
      await this.refreshTokenRepository.save(r_token_object);
    return {
      status: 'success',
      access_token: access_token,
      refresh_token: r_token,
    };
  }
}
