import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { RoleAssignmentsService } from './role-assignments.service';
import { CreateRoleAssignmentDto } from './dtos/create-role-assignment.dto';
import { UpdateAssignmentStatusDto } from './dtos/update-assignment-status.dto';

@Controller('projects/:projectId')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectAssignmentsController {
  constructor(private readonly assignments: RoleAssignmentsService) {}

  @Post('role-assignments')
  @Roles(UserRole.ADMIN)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRoleAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.assignments.create(projectId, dto, user.sub);
    return { status: 'success', data };
  }

  @Get('role-assignments')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.assignments.list(projectId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }

  @Get('team')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER)
  async team(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.assignments.getTeam(projectId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }
}

@Controller('project-role-assignments')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class AssignmentStatusController {
  constructor(private readonly assignments: RoleAssignmentsService) {}

  @Patch(':assignmentId/status')
  @Roles(UserRole.ADMIN, UserRole.FREELANCER)
  async updateStatus(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: UpdateAssignmentStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.assignments.updateStatus(assignmentId, dto, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }
}

@Controller('freelancer/projects')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancerAssignmentsController {
  constructor(private readonly assignments: RoleAssignmentsService) {}

  @Get('assigned')
  async assigned(
    @CurrentUser() user: JwtPayload,
    @Query('phase') phase?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const statuses = status
      ? status
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;

    const { data, total } = await this.assignments.freelancerAssigned(
      user.sub,
      {
        phase,
        statuses,
        page: pageNum,
        limit: limitNum,
      },
    );
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }
}
