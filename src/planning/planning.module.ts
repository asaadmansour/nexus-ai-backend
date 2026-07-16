import { Module } from '@nestjs/common';
import { AgentsModule } from 'src/agents/agents.module';
import { FreelancersModule } from 'src/freelancers/freelancers.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import {
  PlanningSubmissionDetailController,
  ProjectPlanDetailController,
  ProjectPlanningController,
  ProjectTaskController,
} from './planning.controller';
import { AdminPlanningController } from './admin-planning.controller';
import { PlanningSubmissionsService } from './planning-submissions.service';
import { ProjectPlansService } from './project-plans.service';

@Module({
  imports: [
    ProjectsModule,
    FreelancersModule,
    NotificationsModule,
    AgentsModule,
  ],
  controllers: [
    ProjectPlanningController,
    PlanningSubmissionDetailController,
    ProjectPlanDetailController,
    ProjectTaskController,
    AdminPlanningController,
  ],
  providers: [PlanningSubmissionsService, ProjectPlansService],
  exports: [PlanningSubmissionsService, ProjectPlansService],
})
export class PlanningModule {}
