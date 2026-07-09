import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentJob } from './entities/agent-job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AgentJob])],
  exports: [TypeOrmModule],
})
export class AgentsModule {}
