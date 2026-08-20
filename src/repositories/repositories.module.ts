import { Module } from '@nestjs/common';
import { FreelancersModule } from 'src/freelancers/freelancers.module';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { GithubService } from './github.service';
import {
  AdminRepositoriesController,
  ProjectRepositoryController,
  RepositoryCollaboratorsController,
} from './repositories.controller';
import { RepositoriesService } from './repositories.service';
import { RepositoryAutomationService } from './repository-automation.service';

@Module({
  imports: [ProjectsModule, FreelancersModule, NotificationsModule],
  controllers: [
    ProjectRepositoryController,
    RepositoryCollaboratorsController,
    AdminRepositoriesController,
  ],
  providers: [RepositoriesService, GithubService, RepositoryAutomationService],
  exports: [RepositoriesService, GithubService],
})
export class RepositoriesModule {}
