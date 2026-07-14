import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { RedisOptions } from 'ioredis';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { AiJobsProducer } from './ai-jobs.producer';
import { AI_JOB_RETRY, QUEUES } from './queue.constants';

function getRedisConnection(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentJob]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: getRedisConnection(
          configService.getOrThrow<string>('REDIS_URL'),
        ),
        defaultJobOptions: {
          attempts: AI_JOB_RETRY.ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: AI_JOB_RETRY.BACKOFF_DELAY_MS,
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.CV_EXTRACTION },
      { name: QUEUES.ASSESSMENT_GENERATION },
      { name: QUEUES.ASSESSMENT_GRADING },
      { name: QUEUES.PROFILE_EMBEDDING },
    ),
  ],
  providers: [AiJobsProducer],
  exports: [BullModule, AiJobsProducer],
})
export class QueuesModule {}
