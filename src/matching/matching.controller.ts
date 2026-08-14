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
import { MatchingService } from './matching.service';
import { AssignTaskDto } from './dtos/assign-task.dto';
import { StartImplementationMatchingDto } from './dtos/start-implementation-matching.dto';
import { StartPlanningMatchingDto } from './dtos/start-planning-matching.dto';
import { UpdateCandidateStatusDto } from './dtos/update-candidate-status.dto';
import { ReviewRunDto } from './dtos/review-run.dto';

@Controller('projects/:projectId/matching')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ProjectMatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post('planning-roles')
  async startPlanningRoles(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: StartPlanningMatchingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.matchingService.startPlanningRoles(
      projectId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  @Post('implementation-tasks')
  async startImplementationTasks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: StartImplementationMatchingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.matchingService.startImplementationTasks(
      projectId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  @Get('runs')
  async listRuns(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('status') status?: string,
    @Query('targetRoleKey') targetRoleKey?: string,
    @Query('targetType') targetType?: string,
    @Query('targetTaskId') targetTaskId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const { data, total } = await this.matchingService.listRuns(projectId, {
      status,
      targetRoleKey,
      targetType,
      targetTaskId,
      page: pageNum,
      limit: limitNum,
    });
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }
}

@Controller('project-tasks')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ProjectTaskAssignmentController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post(':taskId/assignment')
  async assignTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.matchingService.assignTask(taskId, dto, user.sub);
    return { status: 'success', data };
  }
}

@Controller('matching')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('runs/:runId')
  async getRun(@Param('runId', ParseUUIDPipe) runId: string) {
    const data = await this.matchingService.getRun(runId);
    return { status: 'success', data };
  }

  @Patch('candidates/:candidateId/status')
  async updateCandidateStatus(
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: UpdateCandidateStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.matchingService.updateCandidateStatus(
      candidateId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  @Post('runs/:runId/review')
  async reviewRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: ReviewRunDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.matchingService.reviewRun(runId, dto, user.sub);
    return { status: 'success', data };
  }
}
