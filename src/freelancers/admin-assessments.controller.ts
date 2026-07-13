import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { ReviewAssessmentDto } from 'src/admin/dtos/review-assessment.dto';
import { FreelancerAssessmentsService } from './freelancer-assessments.service';

const ADMIN_ASSESSMENT_STATUSES = [
  'active',
  'in_progress',
  'submitted',
  'passed',
  'failed',
  'expired',
  'needs_review',
] as const;

@Controller('admin/assessments')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAssessmentsController {
  constructor(private readonly assessments: FreelancerAssessmentsService) {}

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const normalizedStatus = this.normalizeStatus(status);
    const { data, total } = await this.assessments.adminList(
      pageNum,
      limitNum,
      normalizedStatus,
    );
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.assessments.adminGetById(id);
    return { status: 'success', data };
  }

  @Patch(':id/review')
  async review(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAssessmentDto,
  ) {
    const data = await this.assessments.adminReview(id, dto, user.sub);
    return { status: 'success', data };
  }

  private normalizeStatus(status?: string) {
    if (!status) return undefined;
    if (
      !ADMIN_ASSESSMENT_STATUSES.includes(
        status as (typeof ADMIN_ASSESSMENT_STATUSES)[number],
      )
    ) {
      throw new BadRequestException('Unsupported assessment status');
    }
    return status === 'active' ? 'in_progress' : status;
  }
}
