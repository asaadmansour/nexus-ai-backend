import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { ReviewSubmissionDto } from 'src/delivery/dtos/review-submission.dto';
import { ReviewProjectHandoffDto } from 'src/delivery/dtos/review-project-handoff.dto';
import { ReviewRunDto } from 'src/matching/dtos/review-run.dto';
import { ReviewPaymentReleaseRequestDto } from 'src/payments/dtos/review-payment-release-request.dto';
import { MaterializePlanDto } from 'src/planning/dtos/materialize-plan.dto';
import { ReviewPlanDto } from 'src/planning/dtos/review-plan.dto';
import { ReviewPlanningSubmissionDto } from 'src/planning/dtos/review-planning-submission.dto';
import { ReviewerService } from './reviewer.service';

@Controller('reviewer')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class ReviewerController {
  constructor(private readonly reviewer: ReviewerService) {}

  @Get('projects')
  async projects(@CurrentUser() user: JwtPayload) {
    return {
      status: 'success',
      data: await this.reviewer.listProjects(user.sub),
    };
  }

  @Get('projects/:projectId/overview')
  async overview(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.overview(projectId, user.sub),
    };
  }

  @Get('projects/:projectId/planning-submissions')
  async planningSubmissions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      ...(await this.reviewer.listPlanningSubmissions(projectId, user.sub)),
    };
  }

  @Get('projects/:projectId/plans')
  async plans(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      ...(await this.reviewer.listPlans(projectId, user.sub)),
    };
  }

  @Get('projects/:projectId/matching-runs')
  async matchingRuns(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      ...(await this.reviewer.listMatchingRuns(projectId, user.sub)),
    };
  }

  @Get('matching-runs/:id')
  async matchingRun(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.getMatchingRun(id, user.sub),
    };
  }

  @Get('projects/:projectId/submissions')
  async submissions(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      ...(await this.reviewer.listSubmissions(projectId, user.sub)),
    };
  }

  @Get('projects/:projectId/payment-release-requests')
  async releases(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      ...(await this.reviewer.listReleaseRequests(projectId, user.sub)),
    };
  }

  @Get('projects/:projectId/handoff')
  async handoff(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.getHandoff(projectId, user.sub),
    };
  }

  @Patch('projects/:projectId/handoff/review')
  async reviewHandoff(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ReviewProjectHandoffDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.reviewHandoff(projectId, dto, user.sub),
    };
  }

  @Patch('planning-submissions/:id/review')
  async reviewPlanning(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPlanningSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.reviewPlanningSubmission(id, dto, user.sub),
    };
  }

  @Get('planning-submissions/:id')
  async planningSubmission(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.getPlanningSubmission(id, user.sub),
    };
  }

  @Patch('project-plans/:id/review')
  async reviewPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.reviewPlan(id, dto, user.sub),
    };
  }

  @Get('project-plans/:id')
  async plan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.getPlan(id, user.sub),
    };
  }

  @Post('project-plans/:id/materialize')
  async materialize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MaterializePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.materializePlan(id, dto, user.sub),
    };
  }

  @Post('matching-runs/:id/review')
  async reviewMatching(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRunDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.reviewMatchingRun(id, dto, user.sub),
    };
  }

  @Patch('submissions/:id/review')
  async reviewSubmission(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.reviewSubmission(id, dto, user.sub),
    };
  }

  @Post('submissions/:id/evaluation/retry')
  async retrySubmissionEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.retrySubmissionEvaluation(id, user.sub),
    };
  }

  @Post('submissions/:id/pull-request/retarget')
  async retargetSubmissionPullRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.retargetSubmissionPullRequest(id, user.sub),
    };
  }

  @Get('submissions/:id')
  async submission(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.getSubmission(id, user.sub),
    };
  }

  @Patch('payment-release-requests/:id/review')
  async reviewRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPaymentReleaseRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.reviewer.reviewReleaseRequest(id, dto, user),
    };
  }
}
