import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FreelancerProfile } from './entities/freelancer-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FreelancerProfile])],
  exports: [TypeOrmModule],
})
export class FreelancersModule {}
