import { Module } from '@nestjs/common';
import { AgentsModule } from 'src/agents/agents.module';
import { FreelancersModule } from 'src/freelancers/freelancers.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { QueuesModule } from 'src/queues/queues.module';
import {
  PlanningSubmissionDetailController,
  ProjectPlanDetailController,
  ProjectPlanningController,
  ProjectTaskController,
} from './planning.controller';
import { AdminPlanningController } from './admin-planning.controller';
import { PlanningSubmissionsService } from './planning-submissions.service';
import { ProjectPlansService } from './project-plans.service';
import { ProjectPlanGenerationProcessor } from './jobs/project-plan-generation.processor';
import { areQueuesEnabled } from 'src/queues/queue-runtime';

const queueProcessors = areQueuesEnabled()
  ? [ProjectPlanGenerationProcessor]
  : [];

@Module({
  imports: [
    ProjectsModule,
    FreelancersModule,
    NotificationsModule,
    QueuesModule,
    AgentsModule,
  ],
  controllers: [
    ProjectPlanningController,
    PlanningSubmissionDetailController,
    ProjectPlanDetailController,
    ProjectTaskController,
    AdminPlanningController,
  ],
  providers: [
    PlanningSubmissionsService,
    ProjectPlansService,
    ...queueProcessors,
  ],
  exports: [PlanningSubmissionsService, ProjectPlansService],
})
export class PlanningModule {}
