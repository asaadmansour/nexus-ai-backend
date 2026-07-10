import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersController, UploadsController } from './users.controller';
import { UserService } from './users.service';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, FreelancerProfile])],
  exports: [TypeOrmModule],
  controllers: [UsersController, UploadsController],
  providers: [UserService],
})
export class UsersModule {}
