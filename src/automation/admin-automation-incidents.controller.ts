import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { AutomationIncidentsService } from './automation-incidents.service';
import { ResolveAutomationIncidentDto } from './dto/resolve-automation-incident.dto';

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
    @Query('severity') severity?: string,
    @Query('search') search?: string,
    @Query('from') rawFrom?: string,
    @Query('to') rawTo?: string,
    @Query('limit') rawLimit = '100',
    @Query('offset') rawOffset = '0',
  ) {
    const limit = Math.max(
      1,
      Math.min(Number.parseInt(rawLimit, 10) || 100, 250),
    );
    const result = await this.incidents.list({
      status,
      subsystem: subsystem?.trim().slice(0, 50),
      projectId,
      severity,
      search: search?.trim().slice(0, 200),
      from: this.date(rawFrom),
      to: this.date(rawTo),
      limit,
      offset: Math.max(0, Number.parseInt(rawOffset, 10) || 0),
    });
    return { status: 'success', ...result };
  }

  @Get('summary')
  async summary(@Query('windowDays') rawWindowDays = '7') {
    const windowDays = Math.max(
      1,
      Math.min(Number.parseInt(rawWindowDays, 10) || 7, 90),
    );
    return {
      status: 'success',
      data: await this.incidents.summary(windowDays),
    };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { status: 'success', ...(await this.incidents.detail(id)) };
  }

  @Patch(':id/resolve')
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResolveAutomationIncidentDto,
  ) {
    return {
      status: 'success',
      data: await this.incidents.resolveById(id, body.resolutionNote),
    };
  }

  private date(value?: string) {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
