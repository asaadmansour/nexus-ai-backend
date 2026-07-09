import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';
import { Repository } from 'typeorm';

@Controller('admin')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(Project) private projectRepository: Repository<Project>,
  ) {}

  @Get('users')
  async getUsers() {
    const users = await this.userRepository.find({ order: { createdAt: 'DESC' } });
    return { status: 'success', data: users };
  }

  @Get('projects')
  async getProjects() {
    const projects = await this.projectRepository.find({ order: { createdAt: 'DESC' }, relations: ['customer'] });
    return { status: 'success', data: projects };
  }

  @Get('stats')
  async getStats() {
    const totalUsers = await this.userRepository.count();
    const totalProjects = await this.projectRepository.count();
    
    return {
      status: 'success',
      data: {
        totalUsers,
        totalProjects,
      }
    };
  }
}
