import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

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

  retrieveAccount(accountId: string) {
    return this.stripe.accounts.retrieve(accountId);
  }

  createPaymentIntent(params: Stripe.PaymentIntentCreateParams) {
    return this.stripe.paymentIntents.create(params);
  }

  createCheckoutSession(params: Stripe.Checkout.SessionCreateParams) {
    return this.stripe.checkout.sessions.create(params);
  }

  constructWebhookEvent(payload: Buffer | string, signature: string) {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      throw new InternalServerErrorException('STRIPE_WEBHOOK_SECRET is not set');
    }

    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
  }
}
