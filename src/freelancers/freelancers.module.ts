import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FreelancerAssessmentAnswer } from './entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from './entities/freelancer-assessment-event.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FreelancerProfile,
      FreelancerAssessment,
      FreelancerAssessmentQuestion,
      FreelancerAssessmentAnswer,
      FreelancerAssessmentEvent,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class FreelancersModule {}
