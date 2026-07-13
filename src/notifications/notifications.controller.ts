import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import type { AuthenticatedRequest } from 'src/common/interfaces/jwt-payload.interface';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @Request() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const userId = req.user.sub;
    const data = await this.notificationsService.getNotifications(
      userId,
      page,
      limit,
    );
    const unreadCount = await this.notificationsService.countUnread(userId);
    return {
      status: 'success',
      data,
      unreadCount,
    };
  }

  @Patch(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user.sub;
    const data = await this.notificationsService.markAsRead(id, userId);
    return { status: 'success', data };
  }

  @Patch('read-all')
  async markAllAsRead(@Request() req: AuthenticatedRequest) {
    const userId = req.user.sub;
    const data = await this.notificationsService.markAllAsRead(userId);
    return { status: 'success', data };
  }
}
