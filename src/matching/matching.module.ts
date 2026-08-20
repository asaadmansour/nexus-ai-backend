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
  ProjectTaskAssignmentController,
} from './matching.controller';
import { AdminMatchingController } from './admin-matching.controller';
import { MatchingService } from './matching.service';
import { ProjectInvitation } from './entities/project-invitation.entity';
import { InvitationsController } from './invitations.controller';
import { MatchingAutomationService } from './matching-automation.service';
import { RepositoriesModule } from 'src/repositories/repositories.module';

@Module({
  imports: [
    AgentsModule,
    ProjectsModule,
    FreelancersModule,
    NotificationsModule,
    RepositoriesModule,
    TypeOrmModule.forFeature([
      MatchingRun,
      MatchingCandidate,
      ProjectInvitation,
    ]),
  ],
  controllers: [
    ProjectMatchingController,
    MatchingController,
    ProjectTaskAssignmentController,
    AdminMatchingController,
    InvitationsController,
  ],
  providers: [MatchingService, MatchingAutomationService],
  exports: [TypeOrmModule, MatchingService],
})
export class MatchingModule {}
