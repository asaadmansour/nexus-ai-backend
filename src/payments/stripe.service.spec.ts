import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'STRIPE_SECRET_KEY' ? 'sk_test_mock' : 'whsec_mock',
            ),
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('verifies and parses both snapshot and v2 thin webhook payloads', () => {
    const snapshotPayload = JSON.stringify({
      id: 'evt_snapshot',
      object: 'event',
      type: 'account.updated',
      data: { object: { id: 'acct_1', object: 'account' } },
    });
    const snapshotSignature = Stripe.webhooks.generateTestHeaderString({
      payload: snapshotPayload,
      secret: 'whsec_mock',
    });
    expect(
      service.constructWebhookEvent(snapshotPayload, snapshotSignature).object,
    ).toBe('event');

    const thinPayload = JSON.stringify({
      id: 'evt_thin',
      object: 'v2.core.event',
      type: 'v2.core.account[requirements].updated',
      created: new Date().toISOString(),
      livemode: false,
      related_object: {
        id: 'acct_2',
        type: 'v2.core.account',
        url: '/v2/core/accounts/acct_2',
      },
    });
    const thinSignature = Stripe.webhooks.generateTestHeaderString({
      payload: thinPayload,
      secret: 'whsec_mock',
    });
    const thinEvent = service.constructWebhookEvent(thinPayload, thinSignature);
    expect(thinEvent.object).toBe('v2.core.event');
    expect('fetchRelatedObject' in thinEvent).toBe(true);
  });
});
