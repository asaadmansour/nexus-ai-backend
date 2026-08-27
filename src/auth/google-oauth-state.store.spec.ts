import type { Request } from 'express';
import { RedisService } from 'src/redis/redis.service';
import { GoogleOAuthStateStore } from './google-oauth-state.store';

describe('GoogleOAuthStateStore', () => {
  it('stores and consumes a one-time OAuth state value', async () => {
    const values = new Map<string, string>();
    const redis = {
      set: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      getDel: jest.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    } as unknown as RedisService;
    const store = new GoogleOAuthStateStore(redis);
    const request = {} as Request;

    const state = await new Promise<string>((resolve, reject) => {
      store.store(request, (error, value) => {
        if (error) reject(error);
        else resolve(String(value));
      });
    });

    await expect(verify(store, request, state)).resolves.toBe(true);
    await expect(verify(store, request, state)).resolves.toBe(false);
  });
});

function verify(store: GoogleOAuthStateStore, request: Request, state: string) {
  return new Promise<boolean>((resolve, reject) => {
    store.verify(request, state, (error, valid) => {
      if (error) reject(error);
      else resolve(valid);
    });
  });
}
