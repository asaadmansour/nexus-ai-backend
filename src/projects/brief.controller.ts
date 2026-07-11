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
import { BriefService } from './brief.service';
import { CreateBriefMessageDto } from './dtos/create-brief-message.dto';
import { UpdateBriefDto } from './dtos/update-brief.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

@Controller('projects/:projectId/brief')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
export class BriefController {
  constructor(private readonly briefService: BriefService) {}

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  getBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.getBrief(
      projectId,
      user.sub,
      user.role === UserRole.ADMIN,
    );
  }

  @Get('messages')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  getMessages(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.getMessages(
      projectId,
      user.sub,
      user.role === UserRole.ADMIN,
    );
  }

  @Post('messages')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  sendMessage(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateBriefMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.sendCustomerMessage(
      projectId,
      user.sub,
      user.role === UserRole.ADMIN,
      dto,
    );
  }

  @Patch()
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  updateBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateBriefDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.updateBrief(
      projectId,
      user.sub,
      user.role === UserRole.ADMIN,
      dto,
    );
  }

  @Post('reopen')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  reopenAiHelp(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.reopenAiHelp(
      projectId,
      user.sub,
      user.role === UserRole.ADMIN,
    );
  }

  @Post('confirm')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  confirmBrief(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.briefService.confirmBrief(
      projectId,
      user.sub,
      user.role === UserRole.ADMIN,
    );
  }
}
