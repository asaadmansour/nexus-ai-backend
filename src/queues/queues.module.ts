import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { getRedisConnectionOptions } from 'src/redis/redis-options';
import { AiJobsProducer } from './ai-jobs.producer';
import { AI_JOB_RETRY, QUEUES } from './queue.constants';
import { AiJobRecoveryService } from './ai-job-recovery.service';
import { areQueuesEnabled } from './queue-runtime';

const queuesEnabled = areQueuesEnabled();

const bullImports = queuesEnabled
  ? [
      BullModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          connection: getRedisConnectionOptions(
            configService.getOrThrow<string>('REDIS_URL'),
            {
              enableOfflineQueue: true,
              enableReadyCheck: false,
              maxRetriesPerRequest: null,
            },
          ),
          defaultJobOptions: {
            attempts: AI_JOB_RETRY.ATTEMPTS,
            backoff: {
              type: 'exponential' as const,
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
        { name: QUEUES.PROJECT_PLAN_GENERATION },
      ),
    ]
  : [];
@Module({
  imports: [TypeOrmModule.forFeature([AgentJob]), ...bullImports],
  providers: [AiJobsProducer, AiJobRecoveryService],
  exports: [
    ...(queuesEnabled ? [BullModule] : []),
    AiJobsProducer,
    AiJobRecoveryService,
  ],
})
export class QueuesModule {}
