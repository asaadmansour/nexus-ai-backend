import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { Project } from '../projects/entities/project.entity';
import { FreelancerProfile } from '../freelancers/entities/freelancer-profile.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Project, FreelancerProfile, User])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}