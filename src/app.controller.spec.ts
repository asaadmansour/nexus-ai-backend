import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import { RedisService } from './redis/redis.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: RedisService, useValue: { ping: jest.fn() } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns a process liveness status without external checks', () => {
      expect(appController.liveness()).toEqual({ status: 'ok' });
    });

    it('reports database and Redis readiness', async () => {
      const dataSource = appController['dataSource'];
      const redisService = appController['redisService'];
      jest.spyOn(dataSource, 'query').mockResolvedValue([{ '?column?': 1 }]);
      jest.spyOn(redisService, 'ping').mockResolvedValue('PONG');

      await expect(appController.readiness()).resolves.toEqual({
        status: 'ok',
        checks: { database: true, redis: true },
      });
    });
  });
});
