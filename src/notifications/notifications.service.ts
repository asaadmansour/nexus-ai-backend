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

  async ensureProjectInvitationNotification(
    invitationId: string,
    input: CreateNotificationInput,
  ) {
    const existing = await this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.type = :type', { type: 'project_invitation' })
      .andWhere("notification.metadata ->> 'invitationId' = :invitationId", {
        invitationId,
      })
      .getOne();
    if (existing) return existing;
    return this.createNotification({
      ...input,
      type: 'project_invitation',
      metadata: { ...(input.metadata ?? {}), invitationId },
    });
  }

  async ensureProjectPlanReviewNotification(
    planId: string,
    input: CreateNotificationInput,
  ) {
    const existing = await this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.type = :type', { type: 'reviewer_attention' })
      .andWhere("notification.metadata ->> 'planId' = :planId", { planId })
      .getOne();
    if (existing) return existing;
    return this.createNotification({
      ...input,
      type: 'reviewer_attention',
      metadata: { ...(input.metadata ?? {}), planId },
    });
  }

  async ensureImplementationFundingReadyNotification(
    input: CreateNotificationInput & { projectId: string },
  ) {
    const existing = await this.notificationRepository.findOne({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        type: 'implementation_funding_ready',
      },
    });
    if (existing) return existing;
    return this.createNotification({
      ...input,
      type: 'implementation_funding_ready',
    });
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
    const content = this.businessEmailContent(notification);
    await this.emailService.sendTransactionalEmail(
      user.email,
      content.subject,
      {
        body: content.body,
        actionUrl,
        actionLabel: content.actionLabel,
      },
    );
  }

  private businessEmailContent(notification: Notification) {
    const normalizedBody = (notification.body ?? notification.title)
      .replaceAll('principal_reviewer', 'principal reviewer')
      .replaceAll('ui_ux', 'UI/UX')
      .replaceAll('changes_requested', 'changes requested')
      .replaceAll('_', ' ');

    const templates: Record<
      string,
      { subject: string; body?: string; actionLabel?: string }
    > = {
      project_invitation: {
        subject: 'You have a new Nexus AI project invitation',
        actionLabel: 'Review invitation',
      },
      invitation_expired: {
        subject: 'Your project invitation expired',
        actionLabel: 'View invitations',
      },
      staffing_update: {
        subject: 'Your project team has an update',
        actionLabel: 'View project team',
      },
      implementation_capacity_update: {
        subject: 'Your project implementation capacity has an update',
        actionLabel: 'Open planning payment',
      },
      implementation_funding_ready: {
        subject: 'Your implementation team is ready to fund',
        actionLabel: 'Fund implementation',
      },
      reviewer_attention: {
        subject: 'A project decision needs your review',
        actionLabel: 'Open reviewer workspace',
      },
      task_assignment: {
        subject: 'You have a new project task',
        actionLabel: 'Open task',
      },
      repository_access: {
        subject: 'Your project repository access is ready',
        actionLabel: 'Open project',
      },
      github_action_required: {
        subject: 'Add your GitHub username to receive project access',
        actionLabel: 'Update profile',
      },
      technical_issue: {
        subject: 'A project setup step needs attention',
        body: 'A technical project setup step could not finish automatically. Open the Nexus AI operations view for the exact issue and recovery action.',
        actionLabel: 'Open project operations',
      },
      automation_incident: {
        subject: 'Nexus AI automation needs attention',
        body: normalizedBody,
        actionLabel: 'Open incident trace',
      },
      principal_reviewer_status: {
        subject: 'Your principal reviewer status changed',
        actionLabel: 'View reviewer profile',
      },
    };
    const template = templates[notification.type] ?? {
      subject: notification.title,
      actionLabel: 'Open Nexus AI',
    };
    return {
      subject: template.subject,
      body: template.body ?? normalizedBody,
      actionLabel: template.actionLabel ?? 'Open Nexus AI',
    };
  }
}
