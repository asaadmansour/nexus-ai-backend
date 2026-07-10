import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';
import { AdminService } from './admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Project])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
