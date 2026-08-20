import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerPerformanceEvent } from 'src/freelancers/entities/freelancer-performance-event.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { ProjectSubmissionReview } from 'src/projects/entities/project-submission-review.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { TaskCheckpoint } from 'src/projects/entities/task-checkpoint.entity';
import { Project } from 'src/projects/entities/project.entity';
import { ProjectHandoff } from 'src/projects/entities/project-handoff.entity';
import { ProjectRating } from 'src/projects/entities/project-rating.entity';
import { ProjectRoleAssignment } from 'src/projects/entities/project-role-assignment.entity';
import { User } from 'src/users/entities/user.entity';
import { EvaluationsModule } from 'src/evaluations/evaluations.module';
import { RepositoriesModule } from 'src/repositories/repositories.module';
import { MatchingModule } from 'src/matching/matching.module';
import {
  AdminSubmissionsController,
  FreelancerSubmissionsController,
  ProjectRevisionRequestsController,
  ProjectSubmissionsController,
  RevisionRequestDetailController,
  SubmissionDetailController,
  ProjectHandoffController,
} from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { ProjectHandoffsService } from './project-handoffs.service';

@Module({
  imports: [
    NotificationsModule,
    PaymentsModule,
    EvaluationsModule,
    RepositoriesModule,
    MatchingModule,
    TypeOrmModule.forFeature([
      Project,
      ProjectHandoff,
      ProjectRating,
      ProjectRoleAssignment,
      ProjectMilestone,
      ProjectTask,
      TaskCheckpoint,
      ProjectRepository,
      ProjectSubmission,
      ProjectSubmissionReview,
      ProjectRevisionRequest,
      FreelancerProfile,
      FreelancerPerformanceEvent,
      User,
    ]),
  ],
  controllers: [
    ProjectSubmissionsController,
    SubmissionDetailController,
    ProjectRevisionRequestsController,
    RevisionRequestDetailController,
    FreelancerSubmissionsController,
    AdminSubmissionsController,
    ProjectHandoffController,
  ],
  providers: [DeliveryService, ProjectHandoffsService],
  exports: [DeliveryService, ProjectHandoffsService],
})
export class DeliveryModule {}
