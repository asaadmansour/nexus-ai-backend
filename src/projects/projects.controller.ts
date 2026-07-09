import { Controller, Post, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dtos/create-project.dto';
import { UpdateProjectDto } from './dtos/update-project.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('projects')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  async createProject(@CurrentUser() user: any, @Body() dto: CreateProjectDto) {
    return await this.projectsService.create(user.sub, dto);
  }

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async getProjects(@CurrentUser() user: any) {
    if (user.role === UserRole.ADMIN) {
      return await this.projectsService.findAll();
    } else {
      return await this.projectsService.findAllForCustomer(user.sub);
    }
  }

  @Get(':id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async getProject(@Param('id') id: string, @CurrentUser() user: any) {
    const isAdmin = user.role === UserRole.ADMIN;
    return await this.projectsService.findOne(id, user.sub, isAdmin);
  }

  @Patch(':id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async updateProject(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateProjectDto,
  ) {
    const isAdmin = user.role === UserRole.ADMIN;
    return await this.projectsService.update(id, user.sub, isAdmin, dto);
  }
}
