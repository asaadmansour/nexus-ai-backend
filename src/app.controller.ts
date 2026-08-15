import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppService } from './app.service';
import { RedisService } from './redis/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get('health')
  async readiness() {
    const [database, redis] = await Promise.allSettled([
      this.dataSource.query('SELECT 1'),
      this.redisService.ping(),
    ]);
    const checks = {
      database: database.status === 'fulfilled',
      redis: redis.status === 'fulfilled',
    };
    if (!checks.database || !checks.redis) {
      throw new ServiceUnavailableException({ status: 'degraded', checks });
    }
    return { status: 'ok', checks };
  }

  @Get('health/live')
  liveness() {
    return { status: 'ok' };
  }
}
