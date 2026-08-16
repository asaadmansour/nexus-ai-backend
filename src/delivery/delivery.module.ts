import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { ProjectRepository } from 'src/projects/entities/project-repository.entity';
import { ProjectRevisionRequest } from 'src/projects/entities/project-revision-request.entity';
import { ProjectSubmissionReview } from 'src/projects/entities/project-submission-review.entity';
import { ProjectSubmission } from 'src/projects/entities/project-submission.entity';
import { ProjectTask } from 'src/projects/entities/project-task.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { EvaluationsModule } from 'src/evaluations/evaluations.module';
import { RepositoriesModule } from 'src/repositories/repositories.module';
import {
  AdminSubmissionsController,
  FreelancerSubmissionsController,
  ProjectRevisionRequestsController,
  ProjectSubmissionsController,
  RevisionRequestDetailController,
  SubmissionDetailController,
} from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [
    NotificationsModule,
    PaymentsModule,
    EvaluationsModule,
    RepositoriesModule,
    TypeOrmModule.forFeature([
      Project,
      ProjectMilestone,
      ProjectTask,
      ProjectRepository,
      ProjectSubmission,
      ProjectSubmissionReview,
      ProjectRevisionRequest,
      FreelancerProfile,
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
  ],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
