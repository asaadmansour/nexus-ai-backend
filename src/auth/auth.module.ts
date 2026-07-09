import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { User } from 'src/users/entities/user.entity';
import { AuthController } from './auth.controller';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from 'src/redis/redis.module';
import { RefreshToken } from './entities/refresh-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    JwtModule.registerAsync({
      global: true,
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '20min' },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
