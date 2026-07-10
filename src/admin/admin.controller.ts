import { Controller, Get, UseGuards, Query } from '@nestjs/common';
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
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
    
    const [users, total] = await this.userRepository.findAndCount({ 
      order: { createdAt: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      select: {
        id: true, firstName: true, lastName: true, email: true, phoneNumber: true,
        isEmailVerified: true, isIdVerified: true, photoUrl: true, role: true, createdAt: true,
      }
    });
    return { status: 'success', data: users, total, page: pageNum, limit: limitNum };
  }

  @Get('projects')
  async getProjects(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    const [projects, total] = await this.projectRepository.findAndCount({ 
      order: { createdAt: 'DESC' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      relations: ['customer'],
      select: {
        id: true,
        title: true,
        description: true,
        budgetMin: true,
        budgetMax: true,
        currency: true,
        deadline: true,
        status: true,
        createdAt: true,
        customer: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
        }
      }
    });
    return { status: 'success', data: projects, total, page: pageNum, limit: limitNum };
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
