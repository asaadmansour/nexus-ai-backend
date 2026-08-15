import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { EvaluationsService } from './evaluations.service';
import { QueueEvaluationDto } from './dtos/queue-evaluation.dto';
import { RetryEvaluationDto } from './dtos/retry-evaluation.dto';

@Controller('project-submissions/:submissionId/evaluations')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class SubmissionEvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  async queue(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: QueueEvaluationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.evaluations.queueForSubmission(
      submissionId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async list(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.evaluations.listForSubmission(submissionId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }
}

@Controller('evaluation-runs')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class EvaluationRunsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get(':evaluationRunId')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async detail(
    @Param('evaluationRunId', ParseUUIDPipe) evaluationRunId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.evaluations.getRun(evaluationRunId, {
      userId: user.sub,
      role: user.role,
    });
    return { status: 'success', data };
  }

  @Post(':evaluationRunId/retry')
  @Roles(UserRole.ADMIN)
  async retry(
    @Param('evaluationRunId', ParseUUIDPipe) evaluationRunId: string,
    @Body() dto: RetryEvaluationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.evaluations.retryRun(
      evaluationRunId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }
}

@Controller('admin/evaluations')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminEvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('recommendation') recommendation?: string,
    @Query('projectId') projectId?: string,
    @Query('submissionId') submissionId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const { data, total } = await this.evaluations.adminList({
      status,
      recommendation,
      projectId,
      submissionId,
      page: pageNum,
      limit: limitNum,
    });
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }
}
