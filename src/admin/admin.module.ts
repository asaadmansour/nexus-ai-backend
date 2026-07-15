import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerAssessment } from 'src/freelancers/entities/freelancer-assessment.entity';
import { FreelancerAssessmentQuestion } from 'src/freelancers/entities/freelancer-assessment-question.entity';
import { FreelancerAssessmentAnswer } from 'src/freelancers/entities/freelancer-assessment-answer.entity';
import { FreelancerAssessmentEvent } from 'src/freelancers/entities/freelancer-assessment-event.entity';
import { FreelancerSkillScore } from 'src/freelancers/entities/freelancer-skill-score.entity';
import { AgentJob } from 'src/agents/entities/agent-job.entity';
import { RefreshToken } from 'src/auth/entities/refresh-token.entity';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { QueuesModule } from 'src/queues/queues.module';

@Module({
  imports: [
    NotificationsModule,
    QueuesModule,
    TypeOrmModule.forFeature([
      User,
      Project,
      FreelancerProfile,
      FreelancerAssessment,
      FreelancerAssessmentQuestion,
      FreelancerAssessmentAnswer,
      FreelancerAssessmentEvent,
      FreelancerSkillScore,
      AgentJob,
      RefreshToken,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
