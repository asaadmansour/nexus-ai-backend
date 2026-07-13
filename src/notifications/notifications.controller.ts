import { Controller, Get, Patch, Param, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from 'src/common/guards/auth.guard';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(@Request() req) {
    const userId = req.user.id;
    const data = await this.notificationsService.getNotifications(userId);
    const unreadCount = data.filter((n) => !n.isRead).length;
    return {
      status: 'success',
      data,
      unreadCount,
    };
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Request() req) {
    const userId = req.user.id;
    const data = await this.notificationsService.markAsRead(id, userId);
    return { status: 'success', data };
  }

  @Patch('read-all')
  async markAllAsRead(@Request() req) {
    const userId = req.user.id;
    const data = await this.notificationsService.markAllAsRead(userId);
    return { status: 'success', data };
  }
}