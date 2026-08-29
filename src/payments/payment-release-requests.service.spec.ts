import { PaymentReleaseRequestsService } from './payment-release-requests.service';

describe('PaymentReleaseRequestsService project completion', () => {
  function setup(existingRefund: Record<string, unknown> | null = null) {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(existingRefund),
    };
    const ledgerRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({ id: 'refund-1', ...value }),
      ),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(ledgerRepository),
    };
    const service = new PaymentReleaseRequestsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, manager, ledgerRepository };
  }

  it('returns exactly the unused held allocation to the customer', async () => {
    const { service, manager, ledgerRepository } = setup();
    const refundCompletionSurplus = Reflect.get(
      service,
      'refundCompletionSurplus',
    ) as (
      manager: unknown,
      project: Record<string, unknown>,
      createdBy: string,
      now: Date,
    ) => Promise<Record<string, unknown>>;
    const now = new Date('2026-08-29T18:00:00.000Z');

    const result = await refundCompletionSurplus.call(
      service,
      manager,
      {
        id: 'project-1',
        customerId: 'customer-1',
        heldAmount: '85602.50',
        releasedAmount: '49736.92',
        quotedCurrency: 'EGP',
        currency: 'EGP',
      },
      'customer-1',
      now,
    );

    expect(result.amount).toBe('35865.58');
    expect(ledgerRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'refund',
        status: 'posted',
        amount: '35865.58',
        metadata: expect.objectContaining({
          refundType: 'project_completion_surplus',
        }),
      }),
    );
  });

  it('does not create a second project-completion refund', async () => {
    const existing = { id: 'existing-refund', amount: '35865.58' };
    const { service, manager, ledgerRepository } = setup(existing);
    const refundCompletionSurplus = Reflect.get(
      service,
      'refundCompletionSurplus',
    ) as (
      manager: unknown,
      project: Record<string, unknown>,
      createdBy: string,
      now: Date,
    ) => Promise<unknown>;

    await expect(
      refundCompletionSurplus.call(
        service,
        manager,
        {
          id: 'project-1',
          customerId: 'customer-1',
          heldAmount: '100.00',
          releasedAmount: '40.00',
          quotedCurrency: 'EGP',
          currency: 'EGP',
        },
        'customer-1',
        new Date(),
      ),
    ).resolves.toBeNull();
    expect(ledgerRepository.save).not.toHaveBeenCalled();
  });

  it('partially refunds the captured Stripe payment with a stable idempotency key', async () => {
    const paymentsRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'payment-1',
          projectId: 'project-1',
          amount: '500.00',
          stripePaymentIntentId: 'pi_project',
        },
      ]),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue(paymentsRepository),
    };
    const ledgerRepository = {
      save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    };
    const stripeService = {
      createRefund: jest.fn().mockResolvedValue({
        id: 're_project',
        status: 'succeeded',
      }),
    };
    const service = new PaymentReleaseRequestsService(
      dataSource as never,
      {} as never,
      ledgerRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      stripeService as never,
    );
    const dispatchCompletionRefund = Reflect.get(
      service,
      'dispatchCompletionRefund',
    ) as (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
    const entry = {
      id: 'ledger-refund-1',
      projectId: 'project-1',
      amount: '358.25',
      currency: 'EGP',
      stripeRefundId: null,
      metadata: { externalRefundStatus: 'pending' },
    };

    await expect(
      dispatchCompletionRefund.call(service, entry),
    ).resolves.toMatchObject({ mode: 'stripe_refund' });
    expect(stripeService.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: 'pi_project',
        amount: 35825,
      }),
      {
        idempotencyKey: 'project-completion-refund:ledger-refund-1:payment-1',
      },
    );
    expect(entry.stripeRefundId).toBe('re_project');
    expect(entry.metadata).toMatchObject({
      externalRefundStatus: 'succeeded',
    });
  });
});
