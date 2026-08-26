import { ConflictException } from '@nestjs/common';
import { BriefService } from './brief.service';

describe('BriefService intake policy', () => {
  function createService(chatStarted: boolean, pendingDocuments: number) {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockResolvedValue(chatStarted),
    };
    const messageRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const documentRepository = {
      count: jest.fn().mockResolvedValue(pendingDocuments),
    };
    const service = new BriefService(
      null as never,
      messageRepository as never,
      documentRepository as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );

    return { service, documentRepository };
  }

  it('rejects document import after a real customer chat message', async () => {
    const { service } = createService(true, 0);
    const assertAllowed = Reflect.get(
      service,
      'assertDocumentImportAllowed',
    ) as (briefId: string) => Promise<void>;

    await expect(assertAllowed.call(service, 'brief-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows document import before guided chat starts', async () => {
    const { service } = createService(false, 0);
    const assertAllowed = Reflect.get(
      service,
      'assertDocumentImportAllowed',
    ) as (briefId: string) => Promise<void>;

    await expect(
      assertAllowed.call(service, 'brief-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks chat while a requirements document is still processing', async () => {
    const { service, documentRepository } = createService(false, 1);
    const assertReady = Reflect.get(
      service,
      'assertNoPendingDocumentImport',
    ) as (briefId: string) => Promise<void>;

    await expect(assertReady.call(service, 'brief-1')).rejects.toThrow(
      ConflictException,
    );
    expect(documentRepository.count).toHaveBeenCalledTimes(1);
  });
});
