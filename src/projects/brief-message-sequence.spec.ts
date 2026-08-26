import { BriefService } from './brief.service';
import { BriefMessage } from './entities/brief-message.entity';

describe('BriefService message sequencing', () => {
  it('locks the brief before calculating MAX(sequence) + 1', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ next: '7' }]),
    };
    const service = new BriefService(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const allocate = Reflect.get(
      service,
      'nextMessageSequence',
    ) as (typeof service)['nextMessageSequence'];

    await expect(allocate.call(service, manager, 'brief-1')).resolves.toBe(7);
    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['brief-message-sequence:brief-1'],
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('MAX(sequence)'),
      ['brief-1'],
    );
  });

  it('creates an initial greeting with a sequence inside the locked transaction', async () => {
    const briefMessageRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ next: 1 }]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(
        (_entity: typeof BriefMessage, value: Record<string, unknown>) => value,
      ),
      save: jest.fn(
        (_entity: typeof BriefMessage, value: Record<string, unknown>) =>
          Promise.resolve(value),
      ),
    };
    const dataSource = {
      transaction: jest.fn(
        (work: (transactionManager: typeof manager) => Promise<void>) =>
          work(manager),
      ),
    };
    const aiService = {
      validateBrief: jest.fn().mockRejectedValue(new Error('offline')),
    };
    const service = new BriefService(
      null as never,
      briefMessageRepository as never,
      null as never,
      null as never,
      aiService as never,
      dataSource as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const ensureGreeting = Reflect.get(
      service,
      'ensureInitialAgentMessage',
    ) as (brief: object, project: object) => Promise<void>;

    await ensureGreeting.call(
      service,
      { id: 'brief-1', aiDecided: null },
      { id: 'project-1', title: 'Bakery site', description: null },
    );

    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[0],
    );
    expect(manager.save).toHaveBeenCalledWith(
      BriefMessage,
      expect.objectContaining({
        briefId: 'brief-1',
        sequence: 1,
        senderType: 'agent',
      }),
    );
  });

  it('does not create a duplicate greeting found after acquiring the lock', async () => {
    const briefMessageRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ next: 2 }]),
      findOne: jest.fn().mockResolvedValue({ id: 'existing-agent-message' }),
      create: jest.fn(),
      save: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(
        (work: (transactionManager: typeof manager) => Promise<void>) =>
          work(manager),
      ),
    };
    const service = new BriefService(
      null as never,
      briefMessageRepository as never,
      null as never,
      null as never,
      {
        validateBrief: jest.fn().mockRejectedValue(new Error('offline')),
      } as never,
      dataSource as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const ensureGreeting = Reflect.get(
      service,
      'ensureInitialAgentMessage',
    ) as (brief: object, project: object) => Promise<void>;

    await ensureGreeting.call(
      service,
      { id: 'brief-1', aiDecided: null },
      { id: 'project-1', title: 'Bakery site', description: null },
    );

    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
