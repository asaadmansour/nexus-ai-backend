import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { name, emails, photos } = profile;
    if (!emails || emails.length === 0) {
      return done(new Error('Email is required'), false);
    }
    
    const userProfile = {
      email: emails[0].value,
      firstName: name?.givenName || '',
      lastName: name?.familyName || '',
      photoUrl: photos && photos.length > 0 ? photos[0].value : null,
    };

    try {
      const user = await this.authService.validateGoogleUser(userProfile);
      done(null, user);
    } catch (err) {
      done(err, false);
    }
  }
}
