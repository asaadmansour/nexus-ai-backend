import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BriefEmbedding } from './entities/brief-embedding.entity';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
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
@Module({
  imports: [
    AgentsModule,
    TypeOrmModule.forFeature([
      Project,
      ProjectStatusHistory,
      Brief,
      BriefEmbedding,
      BriefMessage,
      ProjectRoleAssignment,
      ProjectPlanningSubmission,
      ProjectPlan,
      ProjectSpec,
      ProjectMilestone,
      ProjectTask,
      ProjectTaskDependency,
      ProjectSubmission,
      ProjectSubmissionReview,
      ProjectRevisionRequest,
      EvaluationRun,
      ProjectRepository,
      RepositoryCollaborator,
    ]),
  ],
  controllers: [ProjectsController, BriefController],
  providers: [ProjectsService, BriefService],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
