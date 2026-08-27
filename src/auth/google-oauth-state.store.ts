import * as crypto from 'crypto';
import type { Request } from 'express';
import type OAuth2Strategy from 'passport-oauth2';
import { RedisService } from 'src/redis/redis.service';

type StoreCallback = OAuth2Strategy.StateStoreStoreCallback;
type VerifyCallback = OAuth2Strategy.StateStoreVerifyCallback;
type Metadata = OAuth2Strategy.Metadata;

const GOOGLE_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export class GoogleOAuthStateStore implements OAuth2Strategy.StateStore {
  constructor(private readonly redisService: RedisService) {}

  store(_req: Request, callback: StoreCallback): void;
  store(_req: Request, _meta: Metadata, callback: StoreCallback): void;
  store(
    _req: Request,
    metaOrCallback: Metadata | StoreCallback,
    maybeCallback?: StoreCallback,
  ): void {
    const callback =
      typeof metaOrCallback === 'function' ? metaOrCallback : maybeCallback!;
    const state = crypto.randomBytes(32).toString('hex');
    void this.redisService
      .set(
        `auth:google:state:${state}`,
        'valid',
        GOOGLE_OAUTH_STATE_TTL_SECONDS,
      )
      .then(() => callback(null, state))
      .catch((error: unknown) => callback(this.asError(error), null));
  }

  verify(_req: Request, state: string, callback: VerifyCallback): void;
  verify(
    _req: Request,
    state: string,
    _meta: Metadata,
    callback: VerifyCallback,
  ): void;
  verify(
    _req: Request,
    state: string,
    metaOrCallback: Metadata | VerifyCallback,
    maybeCallback?: VerifyCallback,
  ): void {
    const callback =
      typeof metaOrCallback === 'function' ? metaOrCallback : maybeCallback!;
    if (!state) {
      callback(null, false, { message: 'Missing OAuth state.' });
      return;
    }
    void this.redisService
      .getDel(`auth:google:state:${state}`)
      .then((value) =>
        callback(null, value === 'valid', {
          message:
            value === 'valid' ? undefined : 'Invalid or expired OAuth state.',
        }),
      )
      .catch((error: unknown) => callback(this.asError(error), false, null));
  }

  private asError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
