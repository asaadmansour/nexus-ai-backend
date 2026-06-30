import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentJob } from './entities/agent-job.entity';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgentJob])],
  exports: [TypeOrmModule, AiService],
  controllers: [AiController],
  providers: [AiService],
})
export class AgentsModule {}
