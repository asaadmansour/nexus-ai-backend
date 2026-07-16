import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from 'src/agents/agents.module';
import { FreelancersModule } from 'src/freelancers/freelancers.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { MatchingCandidate } from './entities/matching-candidate.entity';
import { MatchingRun } from './entities/matching-run.entity';
import {
  MatchingController,
  ProjectMatchingController,
} from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [
    AgentsModule,
    ProjectsModule,
    FreelancersModule,
    NotificationsModule,
    TypeOrmModule.forFeature([MatchingRun, MatchingCandidate]),
  ],
  controllers: [ProjectMatchingController, MatchingController],
  providers: [MatchingService],
  exports: [TypeOrmModule, MatchingService],
})
export class MatchingModule {}
