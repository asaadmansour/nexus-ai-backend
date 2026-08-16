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
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { CreateRepositoryDto } from './dtos/create-repository.dto';
import {
  ResendInviteDto,
  SyncCollaboratorsDto,
} from './dtos/sync-collaborators.dto';
import { RepositoriesService } from './repositories.service';

@Controller('projects/:projectId/repository')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class ProjectRepositoryController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  async createRepository(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRepositoryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.repositoriesService.createRepository(
      projectId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMER, UserRole.FREELANCER)
  async getRepository(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.repositoriesService.getProjectRepository(
      projectId,
      {
        userId: user.sub,
        role: user.role,
      },
    );
    return { status: 'success', data };
  }

  @Post('collaborators/sync')
  @Roles(UserRole.ADMIN)
  async syncCollaborators(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SyncCollaboratorsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.repositoriesService.syncCollaborators(
      projectId,
      dto,
      user.sub,
    );
    return { status: 'success', data };
  }

  @Post('evaluation-webhook/sync')
  @Roles(UserRole.ADMIN)
  async syncEvaluationWebhook(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    const data =
      await this.repositoriesService.syncProjectEvaluationWebhook(projectId);
    return { status: 'success', data };
  }
}

@Controller('repository-collaborators')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class RepositoryCollaboratorsController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post(':collaboratorId/resend-invite')
  async resendInvite(
    @Param('collaboratorId', ParseUUIDPipe) collaboratorId: string,
    @Body() dto: ResendInviteDto,
  ) {
    const data = await this.repositoriesService.resendInvite(
      collaboratorId,
      dto,
    );
    return { status: 'success', data };
  }
}

@Controller('admin/repositories')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminRepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
    const { data, total } = await this.repositoriesService.adminList({
      status,
      projectId,
      page: pageNum,
      limit: limitNum,
    });
    return { status: 'success', data, total, page: pageNum, limit: limitNum };
  }
}
