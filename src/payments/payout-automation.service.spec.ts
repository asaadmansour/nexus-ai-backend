import { EscrowLedgerEntry } from './entities/escrow-ledger-entry.entity';
import { PayoutAutomationService } from './payout-automation.service';

describe('PayoutAutomationService', () => {
  const previousTransferSetting = process.env.STRIPE_ENABLE_TRANSFERS;

  afterEach(() => {
    if (previousTransferSetting === undefined) {
      delete process.env.STRIPE_ENABLE_TRANSFERS;
    } else {
      process.env.STRIPE_ENABLE_TRANSFERS = previousTransferSetting;
    }
    jest.restoreAllMocks();
  });

  const buildService = () => {
    const ledgerRepo = {
      find: jest.fn(),
      save: jest.fn((entry: EscrowLedgerEntry) => Promise.resolve(entry)),
    };
    const profileRepo = { findOne: jest.fn() };
    const stripeService = { createTransfer: jest.fn() };
    const notificationsService = { createNotification: jest.fn() };
    const service = new PayoutAutomationService(
      ledgerRepo as never,
      profileRepo as never,
      stripeService as never,
      notificationsService as never,
    );

    return {
      service,
      ledgerRepo,
      profileRepo,
      stripeService,
      notificationsService,
    };
  };

  it('transfers a posted release exactly once with a stable idempotency key', async () => {
    process.env.STRIPE_ENABLE_TRANSFERS = 'true';
    const {
      service,
      ledgerRepo,
      profileRepo,
      stripeService,
      notificationsService,
    } = buildService();
    const entry = {
      id: 'ledger-1',
      projectId: 'project-1',
      freelancerProfileId: 'profile-1',
      amount: '123.45',
      currency: 'EGP',
      reason: 'Approved task',
      stripeTransferId: null,
      metadata: null,
    } as unknown as EscrowLedgerEntry;
    profileRepo.findOne.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      stripeAccountId: 'acct_123',
      stripePayoutsEnabled: true,
      stripeOnboardingStatus: 'completed',
    });
    stripeService.createTransfer.mockResolvedValue({ id: 'tr_123' });

    await expect(service.processEntries([entry])).resolves.toEqual({
      inspected: 1,
      transferred: 1,
      mode: 'stripe_connect',
    });
    expect(stripeService.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12345,
        currency: 'egp',
        destination: 'acct_123',
      }),
      { idempotencyKey: 'nexus-ledger-ledger-1' },
    );
    expect(entry.stripeTransferId).toBe('tr_123');
    expect(ledgerRepo.save).toHaveBeenCalledWith(entry);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'payment_transferred',
      }),
    );

    await service.processEntries([entry]);
    expect(stripeService.createTransfer).toHaveBeenCalledTimes(1);
  });

  it('keeps released earnings in the ledger when external transfers are disabled', async () => {
    process.env.STRIPE_ENABLE_TRANSFERS = 'false';
    const { service, profileRepo, stripeService } = buildService();
    const entry = { id: 'ledger-1' } as EscrowLedgerEntry;

    await expect(service.processEntries([entry])).resolves.toEqual({
      inspected: 1,
      transferred: 0,
      mode: 'ledger_only',
    });
    expect(profileRepo.findOne).not.toHaveBeenCalled();
    expect(stripeService.createTransfer).not.toHaveBeenCalled();
  });
});
