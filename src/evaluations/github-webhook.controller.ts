import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { GithubWebhookService } from './github-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('repositories/webhooks')
export class GithubWebhookController {
  constructor(private readonly githubWebhooks: GithubWebhookService) {}

  @Post('github')
  handle(
    @Req() request: RawBodyRequest,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-github-delivery') deliveryId?: string,
    @Headers('x-github-event') eventType?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('Missing GitHub webhook raw body');
    }
    if (!signature || !deliveryId || !eventType) {
      throw new BadRequestException('Missing required GitHub webhook headers');
    }
    return this.githubWebhooks.handle({
      rawBody: request.rawBody,
      signature,
      deliveryId,
      eventType,
    });
  }
}
