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
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/common/enums/user-role.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guards';
import { VerifiedGuard } from 'src/common/guards/verified.guard';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { RespondInvitationDto } from './dtos/respond-invitation.dto';
import { MatchingService } from './matching.service';

@Controller('invitations')
@UseGuards(AuthGuard, VerifiedGuard, RolesGuard)
@Roles(UserRole.FREELANCER)
export class InvitationsController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    const data = await this.matchingService.listInvitations(user.sub, status);
    return { status: 'success', data };
  }

  @Patch(':invitationId/respond')
  async respond(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RespondInvitationDto,
  ) {
    const data = await this.matchingService.respondToInvitation(
      invitationId,
      user.sub,
      dto.decision,
      dto.reason,
    );
    return { status: 'success', data };
  }
}
