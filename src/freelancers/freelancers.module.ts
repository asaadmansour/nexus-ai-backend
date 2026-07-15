import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from 'src/agents/agents.module';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { QueuesModule } from 'src/queues/queues.module';
import { FreelancerAssessmentAnswer } from './entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from './entities/freelancer-assessment-event.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerCvVersion } from './entities/freelancer-cv-version.entity';
import { FreelancerProfileEmbedding } from './entities/freelancer-profile-embedding.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancerSkillScore } from './entities/freelancer-skill-score.entity';
import { FreelancerVerificationEvent } from './entities/freelancer-verification-event.entity';
import { FreelancersController } from './freelancers.controller';
import { FreelancersService } from './freelancers.service';
import { FreelancerVerificationController } from './freelancer-verification.controller';
import { FreelancerAssessmentsController } from './freelancer-assessments.controller';
import { FreelancerAssessmentsService } from './freelancer-assessments.service';
import { FreelancerAiJobsService } from './freelancer-ai-jobs.service';
import { AssessmentGenerationProcessor } from './jobs/assessment-generation.processor';
import { CvExtractionProcessor } from './jobs/cv-extraction.processor';
import { ProfileEmbeddingProcessor } from './jobs/profile-embedding.processor';

@Module({
  imports: [
    AgentsModule,
    NotificationsModule,
    QueuesModule,
    TypeOrmModule.forFeature([
      AgentJob,
      FreelancerProfile,
      FreelancerCvVersion,
      FreelancerAssessment,
      FreelancerAssessmentQuestion,
      FreelancerAssessmentAnswer,
      FreelancerAssessmentEvent,
      FreelancerProfileEmbedding,
      FreelancerSkillScore,
      FreelancerVerificationEvent,
    ]),
  ],
  controllers: [
    FreelancersController,
    FreelancerVerificationController,
    FreelancerAssessmentsController,
  ],
  providers: [
    FreelancersService,
    FreelancerAssessmentsService,
    FreelancerAiJobsService,
    CvExtractionProcessor,
    AssessmentGenerationProcessor,
    ProfileEmbeddingProcessor,
  ],
  exports: [TypeOrmModule],
})
export class FreelancersModule {}
