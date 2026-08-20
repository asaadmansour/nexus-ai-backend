import {
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, Subscriber } from 'rxjs';
import { EmailService } from 'src/email/email.service';
import { User } from 'src/users/entities/user.entity';
import { Notification } from './entities/notification.entity';

export interface CreateNotificationInput {
  userId: string;
  title: string;
  body?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  type?: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  sendEmail?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly subscribers = new Map<
    string,
    Set<Subscriber<MessageEvent>>
  >();

  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailService: EmailService,
  ) {}

  async getNotifications(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));

    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
  }

  async createNotification(input: CreateNotificationInput) {
    const notification = this.notificationRepository.create({
      userId: input.userId,
      title: input.title,
      body: input.body ?? null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      type: input.type ?? 'general',
      actionUrl: input.actionUrl ?? null,
      metadata: input.metadata ?? null,
    });
    const saved = await this.notificationRepository.save(notification);
    this.publish(saved);
    if (input.sendEmail !== false) {
      void this.sendEmail(saved).catch((error) => {
        this.logger.warn(
          `Notification email failed for ${saved.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    return saved;
  }

  stream(userId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listeners = this.subscribers.get(userId) ?? new Set();
      listeners.add(subscriber);
      this.subscribers.set(userId, listeners);
      subscriber.next({ type: 'connected', data: { connected: true } });
      const heartbeat = setInterval(() => {
        subscriber.next({
          type: 'heartbeat',
          data: { at: new Date().toISOString() },
        });
      }, 25_000);
      heartbeat.unref();
      return () => {
        clearInterval(heartbeat);
        listeners.delete(subscriber);
        if (!listeners.size) this.subscribers.delete(userId);
      };
    });
  }

  async countUnread(userId: string) {
    return this.notificationRepository.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    notification.isRead = true;
    notification.readAt = new Date();
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string) {
    await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    return { success: true };
  }

  private publish(notification: Notification) {
    for (const subscriber of this.subscribers.get(notification.userId) ?? []) {
      subscriber.next({
        id: notification.id,
        type: 'notification',
        data: notification,
      });
    }
  }

  private async sendEmail(notification: Notification) {
    const user = await this.userRepository.findOne({
      where: { id: notification.userId },
      select: { id: true, email: true },
    });
    if (!user?.email) return;
    const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') ?? '';
    const actionUrl = notification.actionUrl
      ? notification.actionUrl.startsWith('http')
        ? notification.actionUrl
        : `${baseUrl}${notification.actionUrl}`
      : null;
    await this.emailService.sendTransactionalEmail(
      user.email,
      notification.title,
      {
        body: notification.body ?? notification.title,
        actionUrl,
      },
    );
  }
}
