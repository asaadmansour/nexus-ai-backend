import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from 'src/agents/agents.module';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { QueuesModule } from 'src/queues/queues.module';
import { areQueuesEnabled } from 'src/queues/queue-runtime';
import { Brief } from 'src/projects/entities/brief.entity';
import { EvaluationRun } from 'src/projects/entities/evaluation-run.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectSpec } from 'src/projects/entities/project-spec.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { GithubWebhookEvent } from 'src/projects/entities/github-webhook-event.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { RepositoriesModule } from 'src/repositories/repositories.module';
import { EvaluationsService } from './evaluations.service';
import {
  AdminEvaluationsController,
  EvaluationRunsController,
  SubmissionEvaluationsController,
} from './evaluations.controller';
import { SubmissionEvaluationProcessor } from './jobs/submission-evaluation.processor';
import { SUBMISSION_EVALUATION_DISPATCHER } from 'src/delivery/submission-evaluation-dispatcher';
import { ImplementationEvaluationSandboxService } from './implementation-evaluation-sandbox.service';
import { GithubWebhookService } from './github-webhook.service';
import { GithubWebhookController } from './github-webhook.controller';
import { EvaluationRunRecoveryService } from './evaluation-run-recovery.service';

const queueProcessors = areQueuesEnabled()
  ? [SubmissionEvaluationProcessor, EvaluationRunRecoveryService]
  : [];

@Module({
  imports: [
    QueuesModule,
    AgentsModule,
    NotificationsModule,
    RepositoriesModule,
    TypeOrmModule.forFeature([
      EvaluationRun,
      ProjectSubmission,
      ProjectTask,
      Project,
      Brief,
      ProjectSpec,
      FreelancerProfile,
      AgentJob,
      ProjectRepository,
      GithubWebhookEvent,
      ProjectRevisionRequest,
    ]),
  ],
  controllers: [
    GithubWebhookController,
    SubmissionEvaluationsController,
    EvaluationRunsController,
    AdminEvaluationsController,
  ],
  providers: [
    EvaluationsService,
    ImplementationEvaluationSandboxService,
    GithubWebhookService,
    {
      provide: SUBMISSION_EVALUATION_DISPATCHER,
      useExisting: EvaluationsService,
    },
    ...queueProcessors,
  ],
  exports: [
    EvaluationsService,
    ImplementationEvaluationSandboxService,
    SUBMISSION_EVALUATION_DISPATCHER,
  ],
})
export class EvaluationsModule {}
