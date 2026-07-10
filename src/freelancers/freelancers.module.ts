import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FreelancerAssessmentAnswer } from './entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from './entities/freelancer-assessment-event.entity';
import { FreelancerAssessmentQuestion } from './entities/freelancer-assessment-question.entity';
import { FreelancerAssessment } from './entities/freelancer-assessment.entity';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancersController } from './freelancers.controller';
import { FreelancersService } from './freelancers.service';

@Module({
  imports: [TypeOrmModule.forFeature([FreelancerProfile])],
  controllers: [FreelancersController],
  providers: [FreelancersService],
  exports: [TypeOrmModule],
})
export class FreelancersModule {}
