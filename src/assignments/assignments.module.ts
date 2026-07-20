import { Module } from '@nestjs/common';
import { AgentsModule } from 'src/agents/agents.module';
import { FreelancersModule } from 'src/freelancers/freelancers.module';
import { MatchingModule } from 'src/matching/matching.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import {
  AssignmentStatusController,
  FreelancerAssignmentsController,
  ProjectAssignmentsController,
} from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';

@Module({
  imports: [
    AgentsModule,
    ProjectsModule,
    MatchingModule,
    FreelancersModule,
    NotificationsModule,
  ],
  controllers: [
    ProjectAssignmentsController,
    AssignmentStatusController,
    FreelancerAssignmentsController,
  ],
  providers: [RoleAssignmentsService],
  exports: [RoleAssignmentsService],
})
export class AssignmentsModule {}
