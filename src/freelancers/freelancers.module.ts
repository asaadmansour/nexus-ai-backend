import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from 'src/agents/agents.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { FreelancerAssessmentAnswer } from './entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from './entities/freelancer-assessment-event.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerProfileEmbedding } from './entities/freelancer-profile-embedding.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancersController } from './freelancers.controller';
import { FreelancersService } from './freelancers.service';
import { FreelancerVerificationController } from './freelancer-verification.controller';
import { FreelancerAssessmentsController } from './freelancer-assessments.controller';
import { AdminAssessmentsController } from './admin-assessments.controller';
import { FreelancerAssessmentsService } from './freelancer-assessments.service';

@Module({
  imports: [
    AgentsModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      FreelancerProfile,
      FreelancerAssessment,
      FreelancerAssessmentQuestion,
      FreelancerAssessmentAnswer,
      FreelancerAssessmentEvent,
      FreelancerProfileEmbedding,
    ]),
  ],
  controllers: [
    FreelancersController,
    FreelancerVerificationController,
    FreelancerAssessmentsController,
    AdminAssessmentsController,
  ],
  providers: [FreelancersService, FreelancerAssessmentsService],
  exports: [TypeOrmModule],
})
export class FreelancersModule {}
