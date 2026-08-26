import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export type ParsedStripeWebhookEvent =
  Stripe.Event | Stripe.V2.Core.EventNotification;

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey) {
      throw new InternalServerErrorException('STRIPE_SECRET_KEY is not set');
    }

    this.stripe = new Stripe(secretKey);
  }

  createCustomer(params: Stripe.CustomerCreateParams) {
    return this.stripe.customers.create(params);
  }

  createSetupIntent(customerId: string) {
    return this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
  }

  createConnectAccount(params: Stripe.AccountCreateParams) {
    return this.stripe.accounts.create(params);
  }

  createAccountLink(params: Stripe.AccountLinkCreateParams) {
    return this.stripe.accountLinks.create(params);
  }

  createAccountLoginLink(accountId: string) {
    return this.stripe.accounts.createLoginLink(accountId);
  }

  createConnectedRecipientAccount(
    params: Stripe.V2.Core.AccountCreateParams,
    options?: Stripe.RequestOptions,
  ) {
    return this.stripe.v2.core.accounts.create(params, options);
  }

  createConnectedAccountLink(
    params: Stripe.V2.Core.AccountLinkCreateParams,
    options?: Stripe.RequestOptions,
  ) {
    return this.stripe.v2.core.accountLinks.create(params, options);
  }

  retrieveConnectedAccount(accountId: string) {
    return this.stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.recipient', 'requirements'],
    });
  }

  retrieveAccountForThinEvent(event: Stripe.V2.Core.EventNotification) {
    const related = (
      event as unknown as {
        related_object?: { id?: unknown; type?: unknown } | null;
      }
    ).related_object;
    if (
      related?.type !== 'v2.core.account' ||
      typeof related.id !== 'string' ||
      !related.id
    ) {
      return Promise.resolve(null);
    }
    return this.retrieveConnectedAccount(related.id);
  }

  retrieveAccount(accountId: string) {
    return this.stripe.accounts.retrieve(accountId);
  }

  createPaymentIntent(params: Stripe.PaymentIntentCreateParams) {
    return this.stripe.paymentIntents.create(params);
  }

  createCheckoutSession(params: Stripe.Checkout.SessionCreateParams) {
    return this.stripe.checkout.sessions.create(params);
  }

  retrieveCheckoutSession(sessionId: string) {
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });
  }

  createTransfer(
    params: Stripe.TransferCreateParams,
    options?: Stripe.RequestOptions,
  ) {
    return this.stripe.transfers.create(params, options);
  }

  constructWebhookEvent(
    payload: Buffer | string,
    signature: string,
  ): ParsedStripeWebhookEvent {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'STRIPE_WEBHOOK_SECRET is not set',
      );
    }

    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    let objectType: unknown;
    try {
      objectType = (JSON.parse(text) as { object?: unknown })?.object;
    } catch {
      // Preserve Stripe's signature-first error behavior for malformed input.
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );
    }
    if (objectType === 'v2.core.event') {
      return this.stripe.parseEventNotification(
        payload,
        signature,
        webhookSecret,
      );
    }
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
  }
}
