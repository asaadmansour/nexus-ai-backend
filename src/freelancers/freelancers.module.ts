import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FreelancerProfile } from './entities/freelancer-profile.entity';
import { FreelancersController } from './freelancers.controller';
import { FreelancersService } from './freelancers.service';

@Module({
  imports: [TypeOrmModule.forFeature([FreelancerProfile])],
  controllers: [FreelancersController],
  providers: [FreelancersService],
  exports: [TypeOrmModule, FreelancersService],
})
export class FreelancersModule {}
