import {
  Controller,
  Get,
  UseGuards,
  Query,
  Param,
  Patch,
  Body,
} from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AdminService } from './admin.service';
import { UpdateFreelancerVerificationDto } from './dtos/update-freelancer-verification.dto';
import { ReviewAssessmentDto } from './dtos/review-assessment.dto';

@Controller('admin')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private parsePagination(page: string, limit: string) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
    return { pageNum, limitNum };
  }

  // ===== Users =====

  @Get('users')
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    const { users, total } = await this.adminService.getUsers(pageNum, limitNum);
    return {
      status: 'success',
      data: users,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  // ===== Projects =====

  @Get('projects')
  async getProjects(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    const { projects, total } = await this.adminService.getProjects(pageNum, limitNum);
    return {
      status: 'success',
      data: projects,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  // ===== Stats =====

  @Get('stats')
  async getStats() {
    const data = await this.adminService.getStats();
    return { status: 'success', data };
  }

  // ===== Freelancer Queue (with filters) =====

  @Get('freelancers')
  async getFreelancers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('skills') skills?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    const skillsArray = skills ? skills.split(',') : undefined;
    const { data, total } = await this.adminService.getFreelancers(
      pageNum,
      limitNum,
      status,
      search,
      skillsArray,
      dateFrom,
      dateTo,
    );
    return {
      status: 'success',
      data,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  @Get('freelancers/:id')
  async getFreelancerDetail(@Param('id') id: string) {
    const data = await this.adminService.getFreelancerDetail(id);
    return { status: 'success', data };
  }

  @Patch('freelancers/:id/verification')
  async updateFreelancerVerification(
    @Param('id') id: string,
    @Body() body: UpdateFreelancerVerificationDto,
  ) {
    const data = await this.adminService.updateFreelancerVerification(id, body);
    return { status: 'success', data };
  }

  // ===== Assessment Review (with filters) =====

  @Get('assessments')
  async getAssessments(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    const { data, total } = await this.adminService.getAssessments(
      pageNum,
      limitNum,
      status,
      search,
      dateFrom,
      dateTo,
      minScore ? parseFloat(minScore) : undefined,
      maxScore ? parseFloat(maxScore) : undefined,
    );
    return {
      status: 'success',
      data,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  @Get('assessments/:id')
  async getAssessmentDetail(@Param('id') id: string) {
    const data = await this.adminService.getAssessmentDetail(id);
    return { status: 'success', data };
  }

  @Patch('assessments/:id/review')
  async reviewAssessment(
    @Param('id') id: string,
    @Body() body: ReviewAssessmentDto,
  ) {
    const data = await this.adminService.reviewAssessment(id, body);
    return { status: 'success', data };
  }

  // ===== Agent Overview =====

  @Get('agents/overview')
  async getAgentOverview() {
    const data = await this.adminService.getAgentOverview();
    return { status: 'success', data };
  }

  @Get('agent-jobs')
  async getAgentJobs(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ) {
    const { pageNum, limitNum } = this.parsePagination(page, limit);
    const { data, total } = await this.adminService.getAgentJobs(pageNum, limitNum, status, jobType);
    return {
      status: 'success',
      data,
      total,
      page: pageNum,
      limit: limitNum,
    };
  }

  @Get('agent-jobs/:id')
  async getAgentJobDetail(@Param('id') id: string) {
    const data = await this.adminService.getAgentJobDetail(id);
    return { status: 'success', data };
  }
}