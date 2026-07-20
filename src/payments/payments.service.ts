import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import Stripe from 'stripe';
import { UserRole } from 'src/common/enums/user-role.enum';
import type { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { ProjectMilestone } from 'src/projects/entities/project-milestone.entity';
import { Project } from 'src/projects/entities/project.entity';
import { User } from 'src/users/entities/user.entity';
import { MatchingService } from 'src/matching/matching.service';
import { CreateEscrowIntentDto } from './dtos/create-escrow-intent.dto';
import { ReleasePaymentDto } from './dtos/release-payment.dto';
import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { ProjectPayment } from './entities/project-payment.entity';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';
import { StripeService } from './stripe.service';

type ConnectedStripeAccount = Stripe.Account | Stripe.V2.Core.Account;
type StripeConnectOnboardingUrls = {
  refreshUrl?: string;
  returnUrl?: string;
  country?: string;
};

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
    private readonly matchingService: MatchingService,
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

  async createFreelancerOnboardingLink(
    userId: string,
    urls?: StripeConnectOnboardingUrls,
  ) {
    const profile = await this.getFreelancerProfileOrThrow(userId);
    let stripeAccountId = profile.stripeAccountId;
    const accountCountry = this.stripeConnectCountry(urls?.country);

    if (!stripeAccountId) {
      let account: Stripe.V2.Core.Account;

      try {
        account = await this.stripeService.createConnectedRecipientAccount(
          {
            contact_email: profile.user.email,
            display_name:
              `${profile.user.firstName} ${profile.user.lastName}`.trim() ||
              profile.user.email,
            dashboard: 'express',
            identity: {
              country: accountCountry,
              entity_type: 'individual',
              individual: {
                email: profile.user.email,
                given_name: profile.user.firstName,
                surname: profile.user.lastName,
              },
            },
            configuration: {
              recipient: {
                capabilities: {
                  stripe_balance: {
                    stripe_transfers: {
                      requested: true,
                    },
                  },
                },
              },
            },
            defaults: {
              currency: this.stripeDefaultCurrency(),
              profile: {
                product_description:
                  'Freelance software, product design, and project delivery services for Nexus AI customers.',
              },
              responsibilities: {
                fees_collector: 'application',
                losses_collector: 'application',
              },
            },
            include: ['configuration.recipient', 'requirements'],
            metadata: {
              userId,
              freelancerProfileId: profile.id,
            },
          },
          {
            idempotencyKey: `freelancer-connect-account-${profile.id}-${accountCountry}`,
          },
        );
      } catch (error) {
        if (this.isStripeConnectSetupError(error)) {
          throw new ServiceUnavailableException(
            'Stripe Connect is not enabled for this Stripe account. Enable Connect in the Stripe dashboard, then retry freelancer onboarding.',
          );
        }

        throw error;
      }

      stripeAccountId = account.id;

      await this.freelancerProfilesRepository.update(profile.id, {
        stripeAccountId,
        stripeOnboardingStatus: 'link_created',
        stripeChargesEnabled: this.isAccountOnboarded(account),
        stripePayoutsEnabled: this.isAccountOnboarded(account),
        stripeRequirementsDue: this.accountRequirements(account),
        stripeOnboardedAt: this.isAccountOnboarded(account) ? new Date() : null,
      } as any);
    }

    const returnUrl = this.resolveStripeConnectUrl(
      urls?.returnUrl,
      'STRIPE_CONNECT_RETURN_URL',
    );
    const refreshUrl = this.resolveStripeConnectUrl(
      urls?.refreshUrl,
      'STRIPE_CONNECT_REFRESH_URL',
    );

    const accountLink = await this.createOnboardingAccountLink(
      stripeAccountId,
      refreshUrl,
      returnUrl,
    );

    return {
      status: 'success',
      data: {
        accountId: stripeAccountId,
        url: accountLink.url,
      },
    };
  }

  async createFreelancerDashboardLink(userId: string) {
    const profile = await this.getFreelancerProfileOrThrow(userId);

    if (!profile.stripeAccountId) {
      throw new BadRequestException('Set up Stripe payouts first');
    }

    const account = await this.retrieveConnectedAccount(
      profile.stripeAccountId,
    );
    const onboardingStatus = this.accountOnboardingStatus(account);
    const onboarded = this.isAccountOnboarded(account);
    const onboardedAt = onboarded
      ? (profile.stripeOnboardedAt ?? new Date())
      : null;

    await this.freelancerProfilesRepository.update(profile.id, {
      stripeOnboardingStatus: onboardingStatus,
      stripeChargesEnabled: onboarded,
      stripePayoutsEnabled: onboarded,
      stripeRequirementsDue: this.accountRequirements(account),
      stripeOnboardedAt: onboardedAt,
    } as any);

    if (!onboarded) {
      throw new BadRequestException(
        'Complete Stripe onboarding before opening the Express Dashboard',
      );
    }

    const loginLink = await this.stripeService.createAccountLoginLink(
      profile.stripeAccountId,
    );

    return {
      status: 'success',
      data: {
        accountId: profile.stripeAccountId,
        url: loginLink.url,
      },
    };
  }

  private isStripeConnectSetupError(error: unknown) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
      return false;
    }

    return (
      error.message?.toLowerCase().includes('signed up for connect') ?? false
    );
  }

  private async createOnboardingAccountLink(
    stripeAccountId: string,
    refreshUrl: string,
    returnUrl: string,
  ) {
    try {
      return await this.stripeService.createConnectedAccountLink({
        account: stripeAccountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['recipient'],
            refresh_url: refreshUrl,
            return_url: returnUrl,
            collection_options: {
              fields: 'currently_due',
              future_requirements: 'omit',
            },
          },
        },
      });
    } catch (error) {
      if (!this.isStripeV1AccountCompatibilityError(error)) {
        throw error;
      }

      return this.stripeService.createAccountLink({
        account: stripeAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });
    }
  }

  private async retrieveConnectedAccount(stripeAccountId: string) {
    try {
      return await this.stripeService.retrieveConnectedAccount(stripeAccountId);
    } catch (error) {
      if (!this.isStripeV1AccountCompatibilityError(error)) {
        throw error;
      }

      return this.stripeService.retrieveAccount(stripeAccountId);
    }
  }

  private isStripeV1AccountCompatibilityError(error: unknown) {
    if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
      return false;
    }

    return (
      error.code === 'v1_account_instead_of_v2_account' ||
      error.message?.toLowerCase().includes('v1 account') === true
    );
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

    const account = await this.retrieveConnectedAccount(
      profile.stripeAccountId,
    );
    const onboardingStatus = this.accountOnboardingStatus(account);
    const onboarded = this.isAccountOnboarded(account);
    const onboardedAt = onboarded
      ? (profile.stripeOnboardedAt ?? new Date())
      : null;

    await this.freelancerProfilesRepository.update(profile.id, {
      stripeOnboardingStatus: onboardingStatus,
      stripeChargesEnabled: onboarded,
      stripePayoutsEnabled: onboarded,
      stripeRequirementsDue: this.accountRequirements(account),
      stripeOnboardedAt: onboardedAt,
    } as any);

    return {
      status: 'success',
      data: {
        accountId: account.id,
        onboardingStatus,
        chargesEnabled: onboarded,
        payoutsEnabled: onboarded,
        requirementsDue: this.accountRequirements(account),
        onboardedAt,
      },
    };
  }

  async getCustomerPaymentProjects(userId: string) {
    const projects = await this.projectsRepository.find({
      where: { customerId: userId },
      order: { updatedAt: 'DESC' },
    });
    const projectIds = projects.map((project) => project.id);
    const payments = projectIds.length
      ? await this.paymentsRepository.find({
          where: { projectId: In(projectIds) },
          order: { createdAt: 'DESC' },
        })
      : [];
    const milestones = projectIds.length
      ? await this.milestonesRepository.find({
          where: { projectId: In(projectIds) },
          order: { orderIndex: 'ASC' },
        })
      : [];
    const paymentsByProject = this.groupByProject(payments);
    const milestonesByProject = this.groupByProject(milestones);

    return {
      status: 'success',
      data: projects.map((project) =>
        this.buildProjectPaymentSummary(
          project,
          paymentsByProject.get(project.id) ?? [],
          milestonesByProject.get(project.id) ?? [],
        ),
      ),
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

    const allowedAmount = await this.assertEscrowCheckoutAmount(project, dto);
    const stripeCustomerId = await this.ensureStripeCustomer(user);
    const currency = this.normalizedCurrency(dto.currency || project.currency);
    const amount = allowedAmount.toFixed(2);
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
      amount: this.toMinorUnits(allowedAmount, currency),
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
        amount: allowedAmount,
        currency,
        status: savedPayment.status,
        projectId: project.id,
      },
    };
  }

  async createEscrowCheckoutSession(
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

    const amount = await this.assertEscrowCheckoutAmount(project, dto);
    const currency = this.normalizedCurrency(dto.currency || project.currency);
    const stripeCustomerId = await this.ensureStripeCustomer(user);
    const frontendUrl = this.requiredFrontendUrl();

    const payment = this.paymentsRepository.create({
      projectId,
      milestoneId: dto.milestoneId ?? null,
      customerId: userId,
      amount: amount.toFixed(2),
      currency,
      status: 'requires_payment',
      purpose: dto.purpose,
      metadata: {
        source: 'stripe_checkout_session',
        quoteStatus: project.quoteStatus,
        quotedAmount: project.quotedAmount,
      },
    });
    const savedPayment = await this.paymentsRepository.save(payment);

    const session = await this.stripeService.createCheckoutSession({
      mode: 'payment',
      customer: stripeCustomerId,
      success_url: `${frontendUrl}/projects/${projectId}/payments?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/projects/${projectId}/payments?payment=cancelled`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: this.toMinorUnits(amount, currency),
            product_data: {
              name: `Escrow funding for ${project.title}`,
              description: this.checkoutDescription(project, dto.purpose),
            },
          },
        },
      ],
      payment_intent_data: {
        metadata: {
          projectPaymentId: savedPayment.id,
          projectId,
          customerId: userId,
          milestoneId: dto.milestoneId ?? '',
          purpose: dto.purpose,
        },
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
      stripeCheckoutSessionId: session.id,
      metadata: {
        ...((savedPayment.metadata as Record<string, unknown> | null) ?? {}),
        checkoutSessionStatus: session.status ?? 'unknown',
      },
    });

    return {
      status: 'success',
      data: {
        paymentId: savedPayment.id,
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        amount,
        currency,
        status: savedPayment.status,
        purpose: savedPayment.purpose,
        projectId,
      },
    };
  }

  async getProjectPaymentSummary(projectId: string, user: JwtPayload) {
    const project = await this.getProjectOrThrow(projectId);
    const isAdmin = user.role === UserRole.ADMIN;

    if (!isAdmin && project.customerId !== user.sub) {
      throw new ForbiddenException('You cannot view payments for this project');
    }

    const [payments, milestones] = await Promise.all([
      this.paymentsRepository.find({
        where: { projectId },
        order: { createdAt: 'DESC' },
      }),
      this.milestonesRepository.find({
        where: { projectId },
        order: { orderIndex: 'ASC' },
      }),
    ]);

    return {
      status: 'success',
      data: this.buildProjectPaymentSummary(project, payments, milestones),
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
    const eventType = event.type as string;

    switch (eventType) {
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
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
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
      case 'v2.core.account[requirements].updated':
        await this.handleAccountUpdated(
          event.data.object as unknown as Stripe.V2.Core.Account,
        );
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

    await this.markPaymentSucceeded(payment, {
      stripePaymentIntentStatus: intent.status,
      latestCharge:
        typeof intent.latest_charge === 'string'
          ? intent.latest_charge
          : (intent.latest_charge?.id ?? null),
    });
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ) {
    const projectPaymentId = session.metadata?.projectPaymentId;
    const payment = projectPaymentId
      ? await this.paymentsRepository.findOne({
          where: { id: projectPaymentId },
        })
      : await this.paymentsRepository.findOne({
          where: { stripeCheckoutSessionId: session.id },
        });

    if (!payment) {
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    payment.stripeCheckoutSessionId = session.id;
    payment.stripePaymentIntentId =
      payment.stripePaymentIntentId ?? paymentIntentId;

    if (session.payment_status === 'paid') {
      await this.markPaymentSucceeded(payment, {
        checkoutSessionStatus: session.status,
        checkoutPaymentStatus: session.payment_status,
        stripePaymentIntentId: paymentIntentId,
      });
      return;
    }

    await this.paymentsRepository.update(payment.id, {
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      metadata: {
        ...((payment.metadata as Record<string, unknown> | null) ?? {}),
        checkoutSessionStatus: session.status ?? 'unknown',
        checkoutPaymentStatus: session.payment_status,
      },
    });
  }

  private async markPaymentSucceeded(
    payment: ProjectPayment,
    metadata: Record<string, unknown>,
  ) {
    await this.paymentsRepository.update(payment.id, {
      status: 'succeeded',
      paidAt: payment.paidAt ?? new Date(),
      failedAt: null,
      stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      metadata: {
        ...((payment.metadata as Record<string, unknown> | null) ?? {}),
        ...metadata,
      },
    } as any);

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
      await this.projectsRepository
        .createQueryBuilder()
        .update(Project)
        .set({
          heldAmount: () => '"held_amount" + :amount',
          quoteStatus: 'accepted',
        } as any)
        .where('id = :projectId', { projectId: payment.projectId })
        .setParameter('amount', payment.amount)
        .execute();
    }

    if (payment.purpose === 'full_project_deposit') {
      await this.matchingService.autoStartPlanningRoles(payment.projectId);
    }
  }

  private async handlePaymentIntentFailed(intent: Stripe.PaymentIntent) {
    await this.paymentsRepository.update({ stripePaymentIntentId: intent.id }, {
      status: 'failed',
      failedAt: new Date(),
      metadata: {
        stripePaymentIntentStatus: intent.status,
        lastPaymentError: intent.last_payment_error ?? null,
      },
    } as any);
  }

  private async handleSetupIntentSucceeded(intent: Stripe.SetupIntent) {
    const customerId =
      typeof intent.customer === 'string'
        ? intent.customer
        : intent.customer?.id;
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

  private async handleAccountUpdated(account: ConnectedStripeAccount) {
    const profile = await this.freelancerProfilesRepository.findOne({
      where: { stripeAccountId: account.id },
    });

    if (!profile) {
      return;
    }

    await this.freelancerProfilesRepository.update(profile.id, {
      stripeOnboardingStatus: this.accountOnboardingStatus(account),
      stripeChargesEnabled: this.isAccountOnboarded(account),
      stripePayoutsEnabled: this.isAccountOnboarded(account),
      stripeRequirementsDue: this.accountRequirements(account),
      stripeOnboardedAt: this.isAccountOnboarded(account)
        ? (profile.stripeOnboardedAt ?? new Date())
        : null,
    } as any);
  }

  private buildProjectPaymentSummary(
    project: Project,
    payments: ProjectPayment[],
    milestones: ProjectMilestone[],
  ) {
    const quoteAmount = this.toNumber(project.quotedAmount);
    const milestoneEstimate = this.sumMilestoneBudgets(milestones);
    const finalAmount =
      quoteAmount ?? (milestoneEstimate > 0 ? milestoneEstimate : null);
    const currency =
      project.quotedCurrency ??
      milestones.find((milestone) => milestone.currency)?.currency ??
      project.currency;
    const paidAmount = this.sumPayments(payments, ['succeeded']);
    const pendingAmount = this.sumPayments(payments, [
      'requires_payment',
      'processing',
    ]);
    const remainingAmount =
      finalAmount !== null ? Math.max(finalAmount - paidAmount, 0) : null;
    const quoteStatus = project.quoteStatus ?? 'not_ready';
    const canPay =
      finalAmount !== null &&
      remainingAmount !== null &&
      remainingAmount > 0 &&
      quoteStatus !== 'not_ready' &&
      quoteStatus !== 'out_of_budget';

    return {
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        budgetMin: this.toNumber(project.budgetMin),
        budgetMax: this.toNumber(project.budgetMax),
        currency: project.currency,
        deadline: project.deadline,
        createdAt: project.createdAt,
      },
      quote: {
        amount: finalAmount,
        currency: finalAmount !== null ? currency : null,
        status: quoteStatus,
        generatedAt: project.quoteGeneratedAt,
        notes: project.quoteNotes,
        isOutOfBudget: quoteStatus === 'out_of_budget',
      },
      totals: {
        paidAmount,
        pendingAmount,
        remainingAmount,
        heldAmount: this.toNumber(project.heldAmount) ?? paidAmount,
        releasedAmount: this.toNumber(project.releasedAmount) ?? 0,
        currency,
      },
      actions: {
        canPay,
        payBlockedReason: this.paymentBlockedReason(
          quoteStatus,
          finalAmount,
          remainingAmount,
        ),
        suggestedPaymentAmount: remainingAmount,
        suggestedPaymentPurpose: 'full_project_deposit',
        payButtonLabel: 'Fund project escrow',
      },
      milestones: milestones.map((milestone) => {
        const milestonePayments = payments.filter(
          (payment) => payment.milestoneId === milestone.id,
        );
        const budgetAmount = this.toNumber(milestone.budgetAmount);
        const fundedAmount = this.sumPayments(milestonePayments, ['succeeded']);
        return {
          id: milestone.id,
          title: milestone.title,
          status: milestone.status,
          orderIndex: milestone.orderIndex,
          budgetAmount,
          currency: milestone.currency ?? currency,
          fundedAmount,
          remainingAmount:
            budgetAmount !== null
              ? Math.max(budgetAmount - fundedAmount, 0)
              : null,
          dueAt: milestone.dueAt,
        };
      }),
      payments,
    };
  }

  private async assertEscrowCheckoutAmount(
    project: Project,
    dto: CreateEscrowIntentDto,
  ) {
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    if (project.quoteStatus === 'out_of_budget') {
      throw new BadRequestException(
        'The final estimate is above the project budget. Please revise the budget before paying.',
      );
    }

    const quoteAmount = this.toNumber(project.quotedAmount);
    if (!quoteAmount || project.quoteStatus === 'not_ready') {
      throw new BadRequestException(
        'The final project price is not ready yet. Confirm the requirements brief first.',
      );
    }

    const existingPayments = await this.paymentsRepository.find({
      where: { projectId: project.id },
    });
    const paidAmount = this.sumPayments(existingPayments, ['succeeded']);
    const remainingAmount = Math.max(quoteAmount - paidAmount, 0);

    if (remainingAmount <= 0) {
      throw new ConflictException('This project is already fully funded');
    }

    if (amount > remainingAmount) {
      throw new BadRequestException(
        `Payment amount cannot exceed the remaining escrow amount of ${remainingAmount.toFixed(2)} ${project.quotedCurrency ?? project.currency}`,
      );
    }

    return amount;
  }

  private paymentBlockedReason(
    quoteStatus: string,
    finalAmount: number | null,
    remainingAmount: number | null,
  ) {
    if (quoteStatus === 'out_of_budget') {
      return 'The final estimate is above the project budget. Revise the budget range before funding escrow.';
    }
    if (quoteStatus === 'not_ready' || finalAmount === null) {
      return 'The final price is not ready yet. Confirm the requirements brief first.';
    }
    if (remainingAmount !== null && remainingAmount <= 0) {
      return 'Escrow is fully funded.';
    }
    return null;
  }

  private groupByProject<T extends { projectId: string }>(rows: T[]) {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.projectId) ?? [];
      list.push(row);
      map.set(row.projectId, list);
    }
    return map;
  }

  private sumPayments(payments: ProjectPayment[], statuses: string[]) {
    const statusSet = new Set(statuses);
    return payments.reduce((sum, payment) => {
      if (!statusSet.has(payment.status)) return sum;
      return sum + (this.toNumber(payment.amount) ?? 0);
    }, 0);
  }

  private sumMilestoneBudgets(milestones: ProjectMilestone[]) {
    return milestones.reduce(
      (sum, milestone) => sum + (this.toNumber(milestone.budgetAmount) ?? 0),
      0,
    );
  }

  private checkoutDescription(project: Project, purpose: string) {
    const quote = project.quotedAmount
      ? `Final estimate: ${project.quotedAmount} ${project.quotedCurrency ?? project.currency}.`
      : null;
    return [purpose.replace(/_/g, ' '), quote].filter(Boolean).join(' ');
  }

  private requiredFrontendUrl() {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!frontendUrl) {
      throw new BadRequestException('FRONTEND_URL is not set');
    }
    return frontendUrl.replace(/\/+$/, '');
  }

  private normalizedCurrency(currency: string) {
    return currency.trim().toUpperCase();
  }

  private toNumber(value: string | number | null | undefined) {
    if (value === null || value === undefined) return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
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

  private accountRequirements(account: ConnectedStripeAccount) {
    if (this.isV2Account(account)) {
      return {
        entries: account.requirements?.entries ?? [],
        summary: account.requirements?.summary ?? null,
        recipientTransferStatus: this.recipientTransferStatus(account),
      };
    }

    return {
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      pastDue: account.requirements?.past_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  }

  private isAccountOnboarded(account: ConnectedStripeAccount) {
    if (this.isV2Account(account)) {
      return this.recipientTransferStatus(account) === 'active';
    }

    return account.details_submitted && account.charges_enabled;
  }

  private accountOnboardingStatus(account: ConnectedStripeAccount) {
    if (this.isV2Account(account)) {
      const transferStatus = this.recipientTransferStatus(account);

      if (transferStatus === 'active') {
        return 'completed';
      }

      if (transferStatus === 'pending') {
        return 'in_progress';
      }

      if (transferStatus === 'restricted') {
        return 'restricted';
      }

      return 'disabled';
    }

    if (this.isAccountOnboarded(account) && account.payouts_enabled) {
      return 'completed';
    }

    if (account.details_submitted) {
      return 'in_progress';
    }

    return 'link_created';
  }

  private isV2Account(
    account: ConnectedStripeAccount,
  ): account is Stripe.V2.Core.Account {
    return account.object === 'v2.core.account';
  }

  private recipientTransferStatus(account: Stripe.V2.Core.Account) {
    return (
      account.configuration?.recipient?.capabilities?.stripe_balance
        ?.stripe_transfers?.status ?? 'pending'
    );
  }

  private stripeConnectCountry(country?: string) {
    return (
      country ??
      this.configService.get<string>('STRIPE_CONNECT_ACCOUNT_COUNTRY') ??
      'US'
    ).toUpperCase();
  }

  private stripeDefaultCurrency() {
    return (
      this.configService.get<string>('STRIPE_CONNECT_DEFAULT_CURRENCY') ?? 'usd'
    ).toLowerCase();
  }

  private resolveStripeConnectUrl(value: string | undefined, envKey: string) {
    const url = value ?? this.configService.get<string>(envKey);

    if (!url) {
      throw new BadRequestException('Stripe Connect return URLs are not set');
    }

    try {
      const parsed = new URL(url);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }

      return parsed.toString();
    } catch {
      throw new BadRequestException(
        `${envKey} must be a valid http or https URL`,
      );
    }
  }
}
