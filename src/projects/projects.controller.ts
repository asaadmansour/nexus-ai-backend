import {
  Controller,
  Post,
  Get,
  Delete,
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
  @Roles(UserRole.CUSTOMER)
  async getProjects(@CurrentUser() user: JwtPayload) {
    const data = await this.projectsService.findAllForCustomer(user.sub);
    return { status: 'success', data };
  }

  @Get(':id')
  @Roles(UserRole.CUSTOMER)
  async getProject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.projectsService.findOne(id, user.sub, false);
    return { status: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.CUSTOMER)
  async updateProject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProjectDto,
  ) {
    const data = await this.projectsService.update(id, user.sub, false, dto);
    return { status: 'success', data };
  }

  @Delete(':id')
  @Roles(UserRole.CUSTOMER)
  async deleteProject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.projectsService.remove(id, user.sub, false);
    return { status: 'success' };
  }
}
