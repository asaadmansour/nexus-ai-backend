import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { CreateEscrowIntentDto } from './dtos/create-escrow-intent.dto';
import { ReleasePaymentDto } from './dtos/release-payment.dto';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';
import { StripeService } from './stripe.service';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(FreelancerProfile)
    private readonly freelancerProfilesRepository: Repository<FreelancerProfile>,
    @InjectRepository(Project)
    private readonly projectsRepository: Repository<Project>,
    @InjectRepository(ProjectMilestone)
    private readonly milestonesRepository: Repository<ProjectMilestone>,
    @InjectRepository(ProjectPayment)
    private readonly paymentsRepository: Repository<ProjectPayment>,
    @InjectRepository(EscrowLedgerEntry)
    private readonly ledgerRepository: Repository<EscrowLedgerEntry>,
    @InjectRepository(StripeWebhookEvent)
    private readonly webhookEventsRepository: Repository<StripeWebhookEvent>,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  async createCustomerSetupIntent(userId: string) {
    const user = await this.getUserOrThrow(userId);
    const stripeCustomerId = await this.ensureStripeCustomer(user);
    const setupIntent =
      await this.stripeService.createSetupIntent(stripeCustomerId);

    return {
      status: 'success',
      data: {
        customerId: stripeCustomerId,
        clientSecret: setupIntent.client_secret,
      },
    };
  }

  async createFreelancerOnboardingLink(userId: string) {
    const profile = await this.getFreelancerProfileOrThrow(userId);
    let stripeAccountId = profile.stripeAccountId;

    if (!stripeAccountId) {
      const account = await this.stripeService.createConnectAccount({
        type: 'express',
        email: profile.user.email,
        metadata: {
          userId,
          freelancerProfileId: profile.id,
        },
      });

      stripeAccountId = account.id;

      await this.freelancerProfilesRepository.update(
        profile.id,
        {
          stripeAccountId,
          stripeOnboardingStatus: 'pending',
          stripeChargesEnabled: account.charges_enabled,
          stripePayoutsEnabled: account.payouts_enabled,
          stripeRequirementsDue: this.accountRequirements(account),
          stripeOnboardedAt: this.isAccountOnboarded(account)
            ? new Date()
            : null,
        } as any,
      );
    }

    const returnUrl = this.configService.get<string>(
      'STRIPE_CONNECT_RETURN_URL',
    );
    const refreshUrl = this.configService.get<string>(
      'STRIPE_CONNECT_REFRESH_URL',
    );

    if (!returnUrl || !refreshUrl) {
      throw new BadRequestException('Stripe Connect return URLs are not set');
    }

    const accountLink = await this.stripeService.createAccountLink({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return {
      status: 'success',
      data: {
        accountId: stripeAccountId,
        url: accountLink.url,
      },
    };
  }

  async getFreelancerAccount(userId: string) {
    const profile = await this.getFreelancerProfileOrThrow(userId);

    if (!profile.stripeAccountId) {
      return {
        status: 'success',
        data: {
          accountId: null,
          onboardingStatus: profile.stripeOnboardingStatus,
          chargesEnabled: false,
          payoutsEnabled: false,
          requirementsDue: null,
          onboardedAt: null,
        },
      };
    }

    const account = await this.stripeService.retrieveAccount(
      profile.stripeAccountId,
    );
    const onboardingStatus = this.accountOnboardingStatus(account);

    await this.freelancerProfilesRepository.update(
      profile.id,
      {
        stripeOnboardingStatus: onboardingStatus,
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeRequirementsDue: this.accountRequirements(account),
        stripeOnboardedAt: this.isAccountOnboarded(account)
          ? (profile.stripeOnboardedAt ?? new Date())
          : null,
      } as any,
    );

    return {
      status: 'success',
      data: {
        accountId: account.id,
        onboardingStatus,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirementsDue: this.accountRequirements(account),
        onboardedAt: profile.stripeOnboardedAt,
      },
    };
  }

  async createEscrowIntent(
    projectId: string,
    userId: string,
    dto: CreateEscrowIntentDto,
  ) {
    const user = await this.getUserOrThrow(userId);
    const project = await this.getProjectOrThrow(projectId);

    if (project.customerId !== userId) {
      throw new ForbiddenException('Only the project customer can pay escrow');
    }

    if (dto.milestoneId) {
      await this.assertMilestoneBelongsToProject(dto.milestoneId, projectId);
    }

    const stripeCustomerId = await this.ensureStripeCustomer(user);
    const currency = dto.currency.toUpperCase();
    const amount = dto.amount.toFixed(2);
    const payment = this.paymentsRepository.create({
      projectId,
      milestoneId: dto.milestoneId ?? null,
      customerId: userId,
      amount,
      currency,
      status: 'requires_payment',
      purpose: dto.purpose,
      metadata: {
        source: 'stripe_payment_intent',
      },
    });

    const savedPayment = await this.paymentsRepository.save(payment);
    const paymentIntent = await this.stripeService.createPaymentIntent({
      amount: this.toMinorUnits(dto.amount, currency),
      currency: currency.toLowerCase(),
      customer: stripeCustomerId,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        projectPaymentId: savedPayment.id,
        projectId,
        customerId: userId,
        milestoneId: dto.milestoneId ?? '',
        purpose: dto.purpose,
      },
    });

    await this.paymentsRepository.update(savedPayment.id, {
      stripePaymentIntentId: paymentIntent.id,
      metadata: {
        ...((savedPayment.metadata as Record<string, unknown> | null) ?? {}),
        stripePaymentIntentStatus: paymentIntent.status,
      },
    });

    return {
      status: 'success',
      data: {
        paymentId: savedPayment.id,
        stripePaymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: dto.amount,
        currency,
        status: savedPayment.status,
        projectId: project.id,
      },
    };
  }

  async getProjectPayments(projectId: string, user: JwtPayload) {
    const project = await this.getProjectOrThrow(projectId);
    const isAdmin = user.role === UserRole.ADMIN;

    if (!isAdmin && project.customerId !== user.sub) {
      throw new ForbiddenException('You cannot view payments for this project');
    }

    const payments = await this.paymentsRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });

    return {
      status: 'success',
      data: payments,
    };
  }

  async releaseProjectPayment(
    projectId: string,
    paymentId: string,
    user: JwtPayload,
    dto: ReleasePaymentDto,
  ) {
    const payment = await this.paymentsRepository.findOne({
      where: { id: paymentId, projectId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can release payments');
    }

    if (payment.status !== 'succeeded') {
      throw new ConflictException('Only succeeded escrow payments can release');
    }

    const existingRelease = await this.ledgerRepository.findOne({
      where: {
        paymentId,
        entryType: 'release',
        status: 'posted',
      },
    });

    if (existingRelease) {
      throw new ConflictException('Payment has already been released');
    }

    const ledgerEntry = await this.ledgerRepository.save(
      this.ledgerRepository.create({
        projectId,
        paymentId,
        milestoneId: payment.milestoneId,
        freelancerProfileId: dto.freelancerProfileId ?? null,
        entryType: 'release',
        amount: payment.amount,
        currency: payment.currency,
        status: 'posted',
        reason: dto.reason ?? 'Escrow released',
        createdBy: user.sub,
        postedAt: new Date(),
      }),
    );

    return {
      status: 'success',
      data: {
        payment,
        ledgerEntry,
      },
    };
  }

  async getAdminPayments() {
    const [payments, total] = await this.paymentsRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: 20,
      skip: 0,
      relations: {
        project: true,
        milestone: true,
        customer: true,
      },
    });

    return {
      status: 'success',
      data: payments,
      total,
      page: 1,
      limit: 20,
    };
  }

  async handleStripeWebhook(payload: Buffer | string, signature: string) {
    const event = this.stripeService.constructWebhookEvent(payload, signature);
    const existingEvent = await this.webhookEventsRepository.findOne({
      where: { stripeEventId: event.id },
    });

    if (existingEvent?.processedAt) {
      return {
        status: 'success',
        data: {
          received: true,
          duplicate: true,
        },
      };
    }

    const webhookEvent =
      existingEvent ??
      (await this.webhookEventsRepository.save(
        this.webhookEventsRepository.create({
          stripeEventId: event.id,
          eventType: event.type,
          payload: event as unknown as Record<string, unknown>,
        }),
      ));

    try {
      await this.processStripeEvent(event);
      await this.webhookEventsRepository.update(webhookEvent.id, {
        processedAt: new Date(),
        processingError: null,
      });
    } catch (error) {
      await this.webhookEventsRepository.update(webhookEvent.id, {
        processingError:
          error instanceof Error ? error.message : 'Unknown webhook error',
      });
      throw error;
    }

    return {
      status: 'success',
      data: {
        received: true,
      },
    };
  }

  private async processStripeEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(
          event.data.object as Stripe.PaymentIntent,
        );
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(
          event.data.object as Stripe.PaymentIntent,
        );
        break;
      case 'setup_intent.succeeded':
        await this.handleSetupIntentSucceeded(
          event.data.object as Stripe.SetupIntent,
        );
        break;
      case 'account.updated':
        await this.handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      default:
        break;
    }
  }

  private async handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent) {
    const payment = await this.paymentsRepository.findOne({
      where: { stripePaymentIntentId: intent.id },
    });

    if (!payment) {
      return;
    }

    await this.paymentsRepository.update(
      payment.id,
      {
        status: 'succeeded',
        paidAt: new Date(),
        failedAt: null,
        metadata: {
          ...((payment.metadata as Record<string, unknown> | null) ?? {}),
          stripePaymentIntentStatus: intent.status,
          latestCharge:
            typeof intent.latest_charge === 'string'
              ? intent.latest_charge
              : (intent.latest_charge?.id ?? null),
        },
      } as any,
    );

    const existingHold = await this.ledgerRepository.findOne({
      where: {
        paymentId: payment.id,
        entryType: 'hold',
        status: 'posted',
      },
    });

    if (!existingHold) {
      await this.ledgerRepository.save(
        this.ledgerRepository.create({
          projectId: payment.projectId,
          paymentId: payment.id,
          milestoneId: payment.milestoneId,
          entryType: 'hold',
          amount: payment.amount,
          currency: payment.currency,
          status: 'posted',
          reason: 'Stripe payment intent succeeded',
          postedAt: new Date(),
        }),
      );
    }
  }

  private async handlePaymentIntentFailed(intent: Stripe.PaymentIntent) {
    await this.paymentsRepository.update(
      { stripePaymentIntentId: intent.id },
      {
        status: 'failed',
        failedAt: new Date(),
        metadata: {
          stripePaymentIntentStatus: intent.status,
          lastPaymentError: intent.last_payment_error ?? null,
        },
      } as any,
    );
  }

  private async handleSetupIntentSucceeded(intent: Stripe.SetupIntent) {
    const customerId =
      typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
    const paymentMethodId =
      typeof intent.payment_method === 'string'
        ? intent.payment_method
        : intent.payment_method?.id;

    if (!customerId || !paymentMethodId) {
      return;
    }

    await this.usersRepository.update(
      { stripeCustomerId: customerId },
      { stripeDefaultPaymentMethodId: paymentMethodId },
    );
  }

  private async handleAccountUpdated(account: Stripe.Account) {
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { stripeAccountId: account.id },
    });

    if (!profile) {
      return;
    }

    await this.freelancerProfilesRepository.update(
      profile.id,
      {
        stripeOnboardingStatus: this.accountOnboardingStatus(account),
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeRequirementsDue: this.accountRequirements(account),
        stripeOnboardedAt: this.isAccountOnboarded(account)
          ? (profile.stripeOnboardedAt ?? new Date())
          : null,
      } as any,
    );
  }

  private async ensureStripeCustomer(user: User) {
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await this.stripeService.createCustomer({
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      metadata: {
        userId: user.id,
      },
    });

    await this.usersRepository.update(user.id, {
      stripeCustomerId: customer.id,
    });

    return customer.id;
  }

  private async getUserOrThrow(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async getProjectOrThrow(projectId: string) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  private async getFreelancerProfileOrThrow(userId: string) {
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { userId },
      relations: { user: true },
    });

    if (!profile) {
      throw new NotFoundException('Freelancer profile not found');
    }

    return profile;
  }

  private async assertMilestoneBelongsToProject(
    milestoneId: string,
    projectId: string,
  ) {
    const milestone = await this.milestonesRepository.findOne({
      where: { id: milestoneId, projectId },
    });

    if (!milestone) {
      throw new BadRequestException('Milestone does not belong to project');
    }
  }

  private toMinorUnits(amount: number, currency: string) {
    const zeroDecimalCurrencies = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY']);
    const normalizedCurrency = currency.toUpperCase();

    if (zeroDecimalCurrencies.has(normalizedCurrency)) {
      return Math.round(amount);
    }

    return Math.round(amount * 100);
  }

  private accountRequirements(account: Stripe.Account) {
    return {
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      pastDue: account.requirements?.past_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  }

  private isAccountOnboarded(account: Stripe.Account) {
    return account.details_submitted && account.charges_enabled;
  }

  private accountOnboardingStatus(account: Stripe.Account) {
    if (this.isAccountOnboarded(account) && account.payouts_enabled) {
      return 'completed';
    }

    if (account.details_submitted) {
      return 'submitted';
    }

    return 'pending';
  }
}
