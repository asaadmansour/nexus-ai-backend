import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from './entities/user.entity';
import { UsersController, UploadsController } from './users.controller';
import { UserService } from './users.service';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerVerificationEvent } from 'src/freelancers/entities/freelancer-verification-event.entity';
import { FreelancerAssessment } from 'src/freelancers/entities/freelancer-assessment.entity';
import { QueuesModule } from 'src/queues/queues.module';

@Module({
  imports: [
    QueuesModule,
    TypeOrmModule.forFeature([
      User,
      FreelancerProfile,
      FreelancerAssessment,
      FreelancerVerificationEvent,
    ]),
    ConfigModule,
  ],
  exports: [TypeOrmModule],
  controllers: [UsersController, UploadsController],
  providers: [UserService],
})
export class UsersModule {}
