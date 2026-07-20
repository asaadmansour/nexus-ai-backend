import type { RedisOptions } from 'ioredis';

const DEFAULT_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 2000;

export function getRedisConnectionOptions(
  redisUrl: string,
  overrides: Partial<RedisOptions> = {},
): RedisOptions {
  const url = new URL(redisUrl);
  const db = Number(url.pathname.slice(1) || 0);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    ...getRedisRuntimeOptions(),
    ...overrides,
  };
}

export function getRedisRuntimeOptions(): RedisOptions {
  const maxAttempts = Number(
    process.env.REDIS_RECONNECT_ATTEMPTS ?? DEFAULT_RECONNECT_ATTEMPTS,
  );

  return {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > maxAttempts) return null;
      return Math.min(
        times * DEFAULT_RETRY_DELAY_MS,
        DEFAULT_MAX_RETRY_DELAY_MS,
      );
    },
    reconnectOnError(error) {
      return !isNonRecoverableRedisError(error);
    },
  };
}

export function isNonRecoverableRedisError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return [
    'max requests limit exceeded',
    'wrongpass',
    'noauth authentication required',
    'invalid username-password pair',
  ].some((pattern) => message.includes(pattern));
}

export function formatRedisError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
