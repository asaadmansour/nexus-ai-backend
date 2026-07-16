import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { PlanningSubmissionsService } from './planning-submissions.service';
import { ProjectPlansService } from './project-plans.service';

@Controller('admin')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPlanningController {
  constructor(
    private readonly submissions: PlanningSubmissionsService,
    private readonly plans: ProjectPlansService,
  ) {}

  @Get('planning/submissions')
  async listSubmissions(
    @Query('status') status?: string,
    @Query('submissionType') submissionType?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const { data, total } = await this.submissions.adminListAll({
      status,
      submissionType,
      page: pageNum,
      limit: limitNum,
    });
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }

  @Get('project-plans')
  async listPlans(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const { data, total } = await this.plans.adminListAll({
      status,
      page: pageNum,
      limit: limitNum,
    });
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }
}
