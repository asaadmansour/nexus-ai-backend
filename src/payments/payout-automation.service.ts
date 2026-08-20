import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { UserRole } from 'src/common/enums/user-role.enum';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { NotificationsService } from 'src/notifications/notifications.service';
import { User } from 'src/users/entities/user.entity';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { StripeService } from './stripe.service';

@Injectable()
export class PayoutAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PayoutAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(EscrowLedgerEntry)
    private readonly ledgerRepo: Repository<EscrowLedgerEntry>,
    @InjectRepository(FreelancerProfile)
    private readonly profileRepo: Repository<FreelancerProfile>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stripeService: StripeService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    if (!this.enabled()) return;
    this.timer = setInterval(() => void this.reconcile(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.reconcile(), 10_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile() {
    if (!this.enabled() || this.running)
      return { inspected: 0, transferred: 0 };
    this.running = true;
    try {
      const entries = await this.ledgerRepo.find({
        where: {
          entryType: In(['release', 'governance_release']),
          status: 'posted',
          stripeTransferId: IsNull(),
        },
        order: { createdAt: 'ASC' },
        take: 50,
      });
      return this.processEntries(entries);
    } finally {
      this.running = false;
    }
  }

  async processEntries(entries: EscrowLedgerEntry[]) {
    if (!this.enabled()) {
      return { inspected: entries.length, transferred: 0, mode: 'ledger_only' };
    }
    let transferred = 0;
    for (const entry of entries) {
      if (entry.stripeTransferId || !entry.freelancerProfileId) continue;
      const profile = await this.profileRepo.findOne({
        where: { id: entry.freelancerProfileId },
      });
      if (
        !profile?.stripeAccountId ||
        !profile.stripePayoutsEnabled ||
        profile.stripeOnboardingStatus !== 'completed'
      ) {
        await this.recordWaiting(entry, profile, 'stripe_onboarding_required');
        continue;
      }
      try {
        const transfer = await this.stripeService.createTransfer(
          {
            amount: this.toMinorUnits(Number(entry.amount), entry.currency),
            currency: entry.currency.toLowerCase(),
            destination: profile.stripeAccountId,
            description: entry.reason ?? 'Nexus AI approved earnings',
            metadata: {
              ledgerEntryId: entry.id,
              projectId: entry.projectId,
              freelancerProfileId: profile.id,
            },
          },
          { idempotencyKey: `nexus-ledger-${entry.id}` },
        );
        entry.stripeTransferId = transfer.id;
        entry.metadata = {
          ...(entry.metadata ?? {}),
          transferMode: 'stripe_connect',
          externalTransferStatus: 'succeeded',
          externalTransferAttemptedAt: new Date().toISOString(),
          externalTransferError: null,
        };
        await this.ledgerRepo.save(entry);
        transferred += 1;
        await this.notificationsService.createNotification({
          userId: profile.userId,
          projectId: entry.projectId,
          type: 'payment_transferred',
          title: 'Payout transferred',
          body: `${entry.amount} ${entry.currency} was transferred to your connected Stripe account.`,
          actionUrl: '/freelancer/payments',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const previousStatus = entry.metadata?.externalTransferStatus;
        entry.metadata = {
          ...(entry.metadata ?? {}),
          transferMode: 'stripe_connect',
          externalTransferStatus: 'failed',
          externalTransferAttemptedAt: new Date().toISOString(),
          externalTransferError: message.slice(0, 1000),
          externalTransferAttempts:
            Number(entry.metadata?.externalTransferAttempts ?? 0) + 1,
        };
        await this.ledgerRepo.save(entry);
        this.logger.error(
          `Stripe transfer failed for ledger ${entry.id}: ${message}`,
        );
        if (previousStatus !== 'failed') {
          await this.notifyTransferFailure(entry, profile.userId, message);
        }
      }
    }
    return { inspected: entries.length, transferred, mode: 'stripe_connect' };
  }

  private async recordWaiting(
    entry: EscrowLedgerEntry,
    profile: FreelancerProfile | null,
    reason: string,
  ) {
    const previousStatus = entry.metadata?.externalTransferStatus;
    entry.metadata = {
      ...(entry.metadata ?? {}),
      transferMode: 'stripe_connect',
      externalTransferStatus: 'waiting_for_onboarding',
      externalTransferError: reason,
    };
    await this.ledgerRepo.save(entry);
    if (profile && previousStatus !== 'waiting_for_onboarding') {
      await this.notificationsService.createNotification({
        userId: profile.userId,
        projectId: entry.projectId,
        type: 'payout_setup_required',
        title: 'Complete payout setup',
        body: `${entry.amount} ${entry.currency} is in your Nexus earnings. Complete Stripe onboarding so it can be transferred automatically.`,
        actionUrl: '/freelancer/payments',
      });
    }
  }

  private async notifyTransferFailure(
    entry: EscrowLedgerEntry,
    freelancerUserId: string,
    message: string,
  ) {
    const admins = await this.userRepo.find({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    await Promise.all([
      this.notificationsService.createNotification({
        userId: freelancerUserId,
        projectId: entry.projectId,
        type: 'payout_delayed',
        title: 'Payout transfer delayed',
        body: 'Your earnings are safely recorded, but Stripe could not complete the external transfer yet. The system will retry automatically.',
        actionUrl: '/freelancer/payments',
      }),
      ...admins.map((admin) =>
        this.notificationsService.createNotification({
          userId: admin.id,
          projectId: entry.projectId,
          type: 'technical_issue',
          title: 'Stripe payout requires attention',
          body: `Ledger ${entry.id} will retry automatically. Latest error: ${message.slice(0, 500)}`,
          actionUrl: '/dashboard/admin/payment-release-requests',
        }),
      ),
    ]);
  }

  private enabled() {
    return process.env.STRIPE_ENABLE_TRANSFERS === 'true';
  }

  private toMinorUnits(amount: number, currency: string) {
    const zeroDecimal = new Set([
      'BIF',
      'CLP',
      'DJF',
      'GNF',
      'JPY',
      'KMF',
      'KRW',
      'MGA',
      'PYG',
      'RWF',
      'UGX',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
    ]);
    return zeroDecimal.has(currency.toUpperCase())
      ? Math.round(amount)
      : Math.round(amount * 100);
  }
}
