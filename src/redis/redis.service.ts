import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not defined');
    this.client = new Redis(process.env.REDIS_URL);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async set(key: string, value: string, ttl: number) {
    await this.client.set(key, value, 'EX', ttl);
  }

  async get(key: string) {
    return await this.client.get(key);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async getDel(key: string) {
    const pipe = this.client.multi();
    pipe.get(key);
    pipe.del(key);
    const results = await pipe.exec();
    return results?.[0]?.[1] as string | null;
  }
}
