import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BriefEmbedding } from './entities/brief-embedding.entity';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { BriefDocument } from './entities/brief-document.entity';
import { EvaluationRun } from './entities/evaluation-run.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { ProjectPlan } from './entities/project-plan.entity';
import { ProjectPlanningSubmission } from './entities/project-planning-submission.entity';
import { ProjectRepository } from './entities/project-repository.entity';
import { ProjectRevisionRequest } from './entities/project-revision-request.entity';
import { ProjectRoleAssignment } from './entities/project-role-assignment.entity';
import { ProjectSpec } from './entities/project-spec.entity';
import { ProjectSubmissionReview } from './entities/project-submission-review.entity';
import { ProjectSubmission } from './entities/project-submission.entity';
import { Project } from './entities/project.entity';
import { RepositoryCollaborator } from './entities/repository-collaborator.entity';
import { ProjectTaskDependency } from './entities/project-task-dependency.entity';
import { ProjectTask } from './entities/project-task.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectStatusHistory } from './entities/project-status-history.entity';
import { BriefController } from './brief.controller';
import { BriefService } from './brief.service';
import { AgentsModule } from 'src/agents/agents.module';
import { ProjectPayment } from 'src/payments/entities/project-payment.entity';
import { TaskCheckpoint } from './entities/task-checkpoint.entity';
import { QueuesModule } from 'src/queues/queues.module';
import { areQueuesEnabled } from 'src/queues/queue-runtime';
import { BriefDocumentSecurityService } from './brief-document-security.service';
import { BriefDocumentStorageService } from './brief-document-storage.service';
import { BriefDocumentJobsService } from './brief-document-jobs.service';
import { BriefDocumentProcessingProcessor } from './jobs/brief-document-processing.processor';
import { BriefDocumentAutomationService } from './brief-document-automation.service';

const briefDocumentProcessors = areQueuesEnabled()
  ? [BriefDocumentProcessingProcessor]
  : [];
@Module({
  imports: [
    AgentsModule,
    QueuesModule,
    TypeOrmModule.forFeature([
      Project,
      ProjectStatusHistory,
      Brief,
      BriefDocument,
      BriefEmbedding,
      BriefMessage,
      ProjectRoleAssignment,
      ProjectPlanningSubmission,
      ProjectPlan,
      ProjectSpec,
      ProjectMilestone,
      ProjectTask,
      TaskCheckpoint,
      ProjectTaskDependency,
      ProjectSubmission,
      ProjectSubmissionReview,
      ProjectRevisionRequest,
      EvaluationRun,
      ProjectRepository,
      RepositoryCollaborator,
      ProjectPayment,
    ]),
  ],
  controllers: [ProjectsController, BriefController],
  providers: [
    ProjectsService,
    BriefService,
    BriefDocumentSecurityService,
    BriefDocumentStorageService,
    BriefDocumentJobsService,
    BriefDocumentAutomationService,
    ...briefDocumentProcessors,
  ],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
