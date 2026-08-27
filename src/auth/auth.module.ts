import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { User } from 'src/users/entities/user.entity';
import { AuthController } from './auth.controller';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from 'src/redis/redis.module';
import { RefreshToken } from './entities/refresh-token.entity';
import { GoogleStrategy } from './strategies/google.strategy';
import { EmailModule } from 'src/email/email.module';
import { PhoneVerificationChallenge } from './entities/phone-verification-challenge.entity';
import { GoogleOAuthCallbackGuard } from './guards/google-oauth-callback.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'google' }),
    TypeOrmModule.forFeature([User, RefreshToken, PhoneVerificationChallenge]),
    JwtModule.registerAsync({
      global: true,
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '20min' },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, GoogleOAuthCallbackGuard],
})
export class AuthModule {}
