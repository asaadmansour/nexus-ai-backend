import {
  Controller,
  Get,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { AutomationIncidentsService } from './automation-incidents.service';

@Controller('admin/automation/incidents')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAutomationIncidentsController {
  constructor(private readonly incidents: AutomationIncidentsService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('subsystem') subsystem?: string,
    @Query('projectId', new ParseUUIDPipe({ optional: true }))
    projectId?: string,
    @Query('limit') rawLimit = '100',
  ) {
    const limit = Math.max(
      1,
      Math.min(Number.parseInt(rawLimit, 10) || 100, 250),
    );
    const result = await this.incidents.list({
      status,
      subsystem: subsystem?.trim().slice(0, 50),
      projectId,
      limit,
    });
    return { status: 'success', ...result };
  }
}
