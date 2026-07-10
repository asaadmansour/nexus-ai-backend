import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { Project } from './entities/project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectStatusHistory } from './entities/project-status-history.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectStatusHistory,
      Brief,
      BriefMessage,
    ]),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
