import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { Project } from './entities/project.entity';
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
  exports: [TypeOrmModule],
})
export class ProjectsModule {}
