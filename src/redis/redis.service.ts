import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { formatRedisError, getRedisConnectionOptions } from './redis-options';

const REDIS_READY_TIMEOUT_MS = 5000;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private lastErrorLogAt = 0;
  private readyPromise: Promise<void> | null = null;

  constructor() {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not defined');

    this.client = new Redis({
      ...getRedisConnectionOptions(process.env.REDIS_URL),
      lazyConnect: true,
    });
    this.client.on('error', (error) => this.logConnectionError(error));
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  async set(key: string, value: string, ttl: number) {
    await this.ensureReady();
    await this.client.set(key, value, 'EX', ttl);
  }

  async get(key: string) {
    await this.ensureReady();
    return await this.client.get(key);
  }

  async del(key: string) {
    await this.ensureReady();
    await this.client.del(key);
  }

  async getDel(key: string) {
    await this.ensureReady();
    const pipe = this.client.multi();
    pipe.get(key);
    pipe.del(key);
    const results = await pipe.exec();
    return results?.[0]?.[1] as string | null;
  }

  async setNx(key: string, value: string, ttl: number): Promise<boolean> {
    await this.ensureReady();
    const result = await this.client.set(key, value, 'EX', ttl, 'NX');
    return result === 'OK';
  }

  async incr(key: string, ttl: number): Promise<number> {
    await this.ensureReady();
    const pipe = this.client.multi();
    pipe.incr(key);
    pipe.expire(key, ttl, 'NX');
    const results = await pipe.exec();
    return (results?.[0]?.[1] as number) ?? 0;
  }

  private async ensureReady() {
    if (this.client.status === 'ready') return;

    if (!this.readyPromise) {
      const pendingReady =
        this.client.status === 'wait' || this.client.status === 'end'
          ? this.client.connect().then(() => undefined)
          : this.waitUntilReady();

      this.readyPromise = pendingReady
        .catch((error) => {
          this.logConnectionError(error);
          throw error;
        })
        .finally(() => {
          this.readyPromise = null;
        });
    }

    await this.readyPromise;
  }

  private waitUntilReady() {
    return new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      const cleanup = () => {
        clearTimeout(timeout);
        this.client.off('ready', onReady);
        this.client.off('error', onError);
        this.client.off('end', onEnd);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        reject(new Error('Redis connection ended before it became ready'));
      };
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Redis connection timed out before it became ready'));
      }, REDIS_READY_TIMEOUT_MS);

      this.client.once('ready', onReady);
      this.client.once('error', onError);
      this.client.once('end', onEnd);
    });
  }

  private logConnectionError(error: unknown) {
    const now = Date.now();
    if (now - this.lastErrorLogAt < 30000) return;

    this.lastErrorLogAt = now;
    this.logger.warn(`Redis unavailable: ${formatRedisError(error)}`);
  }
}
