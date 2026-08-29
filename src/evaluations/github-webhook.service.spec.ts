import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { GithubWebhookService } from './github-webhook.service';

describe('GithubWebhookService', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from(
    JSON.stringify({ zen: 'keep it logically awesome' }),
  );
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  function createService(existing: Record<string, unknown> | null = null) {
    const claimBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const events = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn(
        (value: Record<string, unknown>): Record<string, unknown> => value,
      ),
      save: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) =>
          Promise.resolve({ id: 'event', ...value }),
        ),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(claimBuilder),
    };
    const service = new GithubWebhookService(
      { get: jest.fn().mockReturnValue(secret) } as unknown as ConfigService,
      { requeueForRepositoryUpdate: jest.fn() } as never,
      { isCommitAncestor: jest.fn().mockResolvedValue(true) } as never,
      events as never,
      {} as never,
      {} as never,
    );
    return { service, events, claimBuilder };
  }

  it('verifies and durably records a GitHub delivery', async () => {
    const { service, events } = createService();

    await expect(
      service.handle({
        rawBody: body,
        signature,
        deliveryId: 'delivery-1',
        eventType: 'ping',
      }),
    ).resolves.toEqual({
      received: true,
      duplicate: false,
      evaluationsQueued: 0,
    });
    expect(events.save).toHaveBeenCalled();
    expect(events.update).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ processingError: null }),
    );
  });

  it('rejects an invalid signature before parsing or storing the payload', async () => {
    const { service, events } = createService();

    await expect(
      service.handle({
        rawBody: body,
        signature: `sha256=${'0'.repeat(64)}`,
        deliveryId: 'delivery-2',
        eventType: 'ping',
      }),
    ).rejects.toThrow('Invalid GitHub webhook signature');
    expect(events.findOne).not.toHaveBeenCalled();
  });

  it('does not process an already completed delivery twice', async () => {
    const { service, events } = createService({
      id: 'event',
      processedAt: new Date(),
    });

    await expect(
      service.handle({
        rawBody: body,
        signature,
        deliveryId: 'delivery-1',
        eventType: 'ping',
      }),
    ).resolves.toEqual({
      received: true,
      duplicate: true,
      evaluationsQueued: 0,
    });
    expect(events.save).not.toHaveBeenCalled();
  });

  it('claims and retries a previously failed delivery', async () => {
    const { service, events, claimBuilder } = createService({
      id: 'event',
      processedAt: null,
      processingStartedAt: null,
      processingError: 'temporary failure',
    });

    await expect(
      service.handle({
        rawBody: body,
        signature,
        deliveryId: 'delivery-retry',
        eventType: 'ping',
      }),
    ).resolves.toEqual({
      received: true,
      duplicate: false,
      evaluationsQueued: 0,
    });
    expect(claimBuilder.execute).toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  });

  it('acknowledges a concurrent duplicate selected by the unique index', async () => {
    const { service, events } = createService();
    events.save.mockRejectedValueOnce({ code: '23505' });

    await expect(
      service.handle({
        rawBody: body,
        signature,
        deliveryId: 'delivery-race',
        eventType: 'ping',
      }),
    ).resolves.toEqual({
      received: true,
      duplicate: true,
      evaluationsQueued: 0,
    });
    expect(events.update).not.toHaveBeenCalled();
  });

  it('only evaluates terminal GitHub status events', () => {
    const { service } = createService();
    const target = service as unknown as {
      eventTarget: (
        eventType: string,
        payload: Record<string, unknown>,
      ) => Record<string, unknown> | null;
    };
    const sha = 'a'.repeat(40);

    expect(target.eventTarget('status', { sha, state: 'pending' })).toBeNull();
    expect(target.eventTarget('status', { sha, state: 'success' })).toEqual(
      expect.objectContaining({ commitSha: sha, action: 'success' }),
    );
  });
});
