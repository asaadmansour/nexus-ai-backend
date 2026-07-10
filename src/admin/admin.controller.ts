import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
    
    const { users, total } = await this.adminService.getUsers(pageNum, limitNum);
    return { status: 'success', data: users, total, page: pageNum, limit: limitNum };
  }

  @Get('projects')
  async getProjects(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    const { projects, total } = await this.adminService.getProjects(pageNum, limitNum);
    return { status: 'success', data: projects, total, page: pageNum, limit: limitNum };
  }

  @Get('stats')
  async getStats() {
    const data = await this.adminService.getStats();
    return { status: 'success', data };
  }
}
