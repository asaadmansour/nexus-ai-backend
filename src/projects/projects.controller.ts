import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dtos/create-project.dto';
import { UpdateProjectDto } from './dtos/update-project.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

@Controller('projects')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  async createProject(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProjectDto,
  ) {
    const data = await this.projectsService.create(user.sub, dto);
    return { status: 'success', data };
  }

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async getProjects(@CurrentUser() user: JwtPayload) {
    const data =
      user.role === UserRole.ADMIN
        ? await this.projectsService.findAll()
        : await this.projectsService.findAllForCustomer(user.sub);
    return { status: 'success', data };
  }

  @Get(':id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async getProject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const isAdmin = user.role === UserRole.ADMIN;
    const data = await this.projectsService.findOne(id, user.sub, isAdmin);
    return { status: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async updateProject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProjectDto,
  ) {
    const isAdmin = user.role === UserRole.ADMIN;
    const data = await this.projectsService.update(id, user.sub, isAdmin, dto);
    return { status: 'success', data };
  }
}
