import { Module } from '@nestjs/common';
import { AgentsModule } from 'src/agents/agents.module';
import { FreelancersModule } from 'src/freelancers/freelancers.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { QueuesModule } from 'src/queues/queues.module';
import {
  PlanningSubmissionDetailController,
  FreelancerTasksController,
  ProjectPlanDetailController,
  ProjectPlanningController,
  ProjectTaskController,
} from './planning.controller';
import { AdminPlanningController } from './admin-planning.controller';
import { PlanningSubmissionsService } from './planning-submissions.service';
import { ProjectPlansService } from './project-plans.service';
import { ProjectPlanGenerationProcessor } from './jobs/project-plan-generation.processor';
import { PlanningSubmissionEvaluationProcessor } from './jobs/planning-submission-evaluation.processor';
import { areQueuesEnabled } from 'src/queues/queue-runtime';
import { PlanningEvaluationsService } from './planning-evaluations.service';
import { MatchingModule } from 'src/matching/matching.module';
import { PlanningEvaluationSandboxService } from './planning-evaluation-sandbox.service';
import { PaymentsModule } from 'src/payments/payments.module';

const queueProcessors = areQueuesEnabled()
  ? [ProjectPlanGenerationProcessor, PlanningSubmissionEvaluationProcessor]
  : [];

@Module({
  imports: [
    ProjectsModule,
    FreelancersModule,
    NotificationsModule,
    QueuesModule,
    AgentsModule,
    MatchingModule,
    PaymentsModule,
  ],
  controllers: [
    ProjectPlanningController,
    PlanningSubmissionDetailController,
    ProjectPlanDetailController,
    ProjectTaskController,
    FreelancerTasksController,
    AdminPlanningController,
  ],
  providers: [
    PlanningSubmissionsService,
    PlanningEvaluationsService,
    PlanningEvaluationSandboxService,
    ProjectPlansService,
    ...queueProcessors,
  ],
  exports: [
    PlanningSubmissionsService,
    PlanningEvaluationsService,
    ProjectPlansService,
  ],
})
export class PlanningModule {}
