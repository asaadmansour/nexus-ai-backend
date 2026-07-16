import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@Controller('payments/webhooks')
export class StripeWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('stripe')
  handleStripeWebhook(
    @Req() request: RawBodyRequest,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature');
    }

    if (!request.rawBody) {
      throw new BadRequestException('Missing Stripe raw body');
    }

    return this.paymentsService.handleStripeWebhook(
      request.rawBody,
      signature,
    );
  }
}
