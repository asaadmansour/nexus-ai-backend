import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { DeliveryService } from './delivery.service';
import { ProjectHandoffsService } from './project-handoffs.service';
import { ClientHandoffDecisionDto } from './dtos/client-handoff-decision.dto';
import { CreateProjectRatingDto } from './dtos/create-project-rating.dto';
import { CreateRevisionRequestDto } from './dtos/create-revision-request.dto';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { ListRevisionRequestsDto } from './dtos/list-revision-requests.dto';
import { ListSubmissionsDto } from './dtos/list-submissions.dto';
import { ReviewSubmissionDto } from './dtos/review-submission.dto';
import { SubmitSubmissionDto } from './dtos/submit-submission.dto';
import { UpdateRevisionStatusDto } from './dtos/update-revision-status.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';

@Controller('projects/:projectId/submissions')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectSubmissionsController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post()
  @Roles(UserRole.FREELANCER, UserRole.ADMIN)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.createSubmission(
      projectId,
      dto,
      user,
    );
    return { status: 'success', data };
  }

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.FREELANCER, UserRole.ADMIN)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListSubmissionsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.deliveryService.listProjectSubmissions(
      projectId,
      query,
      user,
    );
    return { status: 'success', ...result };
  }
}

@Controller('project-submissions')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class SubmissionDetailController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get(':submissionId')
  @Roles(UserRole.CUSTOMER, UserRole.FREELANCER, UserRole.ADMIN)
  async detail(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.getSubmission(submissionId, user);
    return { status: 'success', data };
  }

  @Patch(':submissionId')
  @Roles(UserRole.FREELANCER, UserRole.ADMIN)
  async update(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: UpdateSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.updateSubmission(
      submissionId,
      dto,
      user,
    );
    return { status: 'success', data };
  }

  @Post(':submissionId/submit')
  @Roles(UserRole.FREELANCER, UserRole.ADMIN)
  async submit(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: SubmitSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.submitSubmission(
      submissionId,
      dto,
      user,
    );
    return { status: 'success', data };
  }

  @Patch(':submissionId/review')
  @Roles(UserRole.ADMIN)
  async review(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ReviewSubmissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.reviewSubmission(
      submissionId,
      dto,
      user,
    );
    return { status: 'success', data };
  }
}

@Controller('projects/:projectId/revision-requests')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectRevisionRequestsController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post()
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRevisionRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.createRevisionRequest(
      projectId,
      dto,
      user,
    );
    return { status: 'success', data };
  }

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.FREELANCER, UserRole.ADMIN)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListRevisionRequestsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.deliveryService.listProjectRevisionRequests(
      projectId,
      query,
      user,
    );
    return { status: 'success', ...result };
  }
}

@Controller('revision-requests')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class RevisionRequestDetailController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Patch(':revisionRequestId/status')
  @Roles(UserRole.FREELANCER, UserRole.ADMIN)
  async updateStatus(
    @Param('revisionRequestId', ParseUUIDPipe) revisionRequestId: string,
    @Body() dto: UpdateRevisionStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.deliveryService.updateRevisionStatus(
      revisionRequestId,
      dto,
      user,
    );
    return { status: 'success', data };
  }
}

@Controller('freelancer/submissions')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class FreelancerSubmissionsController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get()
  async list(
    @Query() query: ListSubmissionsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.deliveryService.listFreelancerSubmissions(
      query,
      user,
    );
    return { status: 'success', ...result };
  }
}

@Controller('admin/submissions')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSubmissionsController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get()
  async list(@Query() query: ListSubmissionsDto) {
    const result = await this.deliveryService.listAdminSubmissions(query);
    return { status: 'success', ...result };
  }
}

@Controller('projects/:projectId/handoff')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectHandoffController {
  constructor(private readonly handoffs: ProjectHandoffsService) {}

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.FREELANCER, UserRole.ADMIN)
  async get(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.handoffs.getForProject(projectId, user),
    };
  }

  @Post('decision')
  @Roles(UserRole.CUSTOMER)
  async decide(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: ClientHandoffDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.handoffs.clientDecision(projectId, dto, user.sub),
    };
  }

  @Get('source')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  async source(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
    @Res() response: Response,
  ) {
    const archive = await this.handoffs.downloadVerifiedSource(projectId, user);
    response.setHeader('Content-Type', archive.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${archive.fileName}"`,
    );
    response.setHeader('Content-Length', archive.buffer.byteLength);
    response.setHeader('X-Content-SHA256', archive.sha256);
    response.setHeader('X-Verified-Commit', archive.commitSha);
    response.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, X-Content-SHA256, X-Verified-Commit',
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(archive.buffer);
  }

  @Post('ratings')
  @Roles(UserRole.CUSTOMER)
  async rate(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectRatingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return {
      status: 'success',
      data: await this.handoffs.rateContributor(projectId, dto, user.sub),
    };
  }

  @Post('retry')
  @Roles(UserRole.ADMIN)
  async retry(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return {
      status: 'success',
      data: await this.handoffs.retry(projectId),
    };
  }
}
