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
import { PlanningSubmissionsService } from './planning-submissions.service';
import { ProjectPlansService } from './project-plans.service';
import { CreatePlanningSubmissionDto } from './dtos/create-planning-submission.dto';
import { ReviewPlanningSubmissionDto } from './dtos/review-planning-submission.dto';
import { GeneratePlanDto } from './dtos/generate-plan.dto';
import { ReviewPlanDto } from './dtos/review-plan.dto';
import { MaterializePlanDto } from './dtos/materialize-plan.dto';
import { UpdateTaskDto } from './dtos/update-task.dto';

function parsePage(page: string, limit: string) {
  return {
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.max(1, Math.min(parseInt(limit, 10) || 20, 100)),
  };
}

@Controller('projects/:projectId')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectPlanningController {
  constructor(
    private readonly submissions: PlanningSubmissionsService,
    private readonly plans: ProjectPlansService,
  ) {}

  @Post('planning-submissions')
  @Roles(UserRole.FREELANCER, UserRole.ADMIN)
  async createSubmission(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreatePlanningSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.submissions.create(projectId, dto, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }

  @Get('planning-submissions')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async listSubmissions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('submissionType') submissionType?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const paged = parsePage(page, limit);
    const { data, total } = await this.submissions.list(
      projectId,
      { userId: user.sub, role: user.role },
      { submissionType, status, ...paged },
    );
    return { status: 'success', data, total, ...paged };
  }

  @Post('plans/generate')
  @Roles(UserRole.ADMIN)
  async generatePlan(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: GeneratePlanDto,
  ) {
    const data = await this.plans.generate(projectId, dto);
    return { status: 'success', data };
  }

  @Get('plans')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER)
  async listPlans(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('isCurrent') isCurrent?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const paged = parsePage(page, limit);
    const { data, total } = await this.plans.list(
      projectId,
      { userId: user.sub, role: user.role },
      {
        status,
        isCurrent: isCurrent === undefined ? undefined : isCurrent === 'true',
        ...paged,
      },
    );
    return { status: 'success', data, total, ...paged };
  }

  @Get('milestones')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async listMilestones(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.plans.listMilestones(projectId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }

  @Get('tasks')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async listTasks(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('milestoneId') milestoneId?: string,
    @Query('status') status?: string,
    @Query('assignedFreelancerProfileId') assignedFreelancerProfileId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const paged = parsePage(page, limit);
    const { data, total } = await this.plans.listTasks(
      projectId,
      { userId: user.sub, role: user.role },
      { milestoneId, status, assignedFreelancerProfileId, ...paged },
    );
    return { status: 'success', data, total, ...paged };
  }
}

@Controller('planning-submissions')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class PlanningSubmissionDetailController {
  constructor(private readonly submissions: PlanningSubmissionsService) {}

  @Get(':submissionId')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async getOne(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.submissions.getById(submissionId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }

  @Patch(':submissionId/review')
  @Roles(UserRole.ADMIN)
  async review(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ReviewPlanningSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.submissions.review(submissionId, dto, user.sub);
    return { status: 'success', data };
  }
}

@Controller('project-plans')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectPlanDetailController {
  constructor(private readonly plans: ProjectPlansService) {}

  @Get(':planId')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER)
  async getOne(
    @Param('planId', ParseUUIDPipe) planId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.plans.getById(planId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }

  @Patch(':planId/review')
  @Roles(UserRole.ADMIN)
  async review(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: ReviewPlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.plans.review(planId, dto, user.sub);
    return { status: 'success', data };
  }

  @Post(':planId/materialize')
  @Roles(UserRole.ADMIN)
  async materialize(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: MaterializePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.plans.materialize(planId, dto, user.sub);
    return { status: 'success', data };
  }
}

@Controller('project-tasks')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectTaskController {
  constructor(private readonly plans: ProjectPlansService) {}

  @Patch(':taskId')
  @Roles(UserRole.ADMIN, UserRole.FREELANCER)
  async update(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.plans.updateTask(taskId, dto, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }
}
