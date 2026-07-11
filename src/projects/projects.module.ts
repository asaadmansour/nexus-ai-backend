import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BriefEmbedding } from './entities/brief-embedding.entity';
import { BriefMessage } from './entities/brief-message.entity';
import { Brief } from './entities/brief.entity';
import { Project } from './entities/project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectStatusHistory } from './entities/project-status-history.entity';
import { BriefController } from './brief.controller';
import { BriefService } from './brief.service';
import { AgentsModule } from 'src/agents/agents.module';
@Module({
  imports: [
    AgentsModule,
    TypeOrmModule.forFeature([
      Project,
      ProjectStatusHistory,
      Brief,
      BriefEmbedding,
      BriefMessage,
    ]),
  ],
  controllers: [ProjectsController, BriefController],
  providers: [ProjectsService, BriefService],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
