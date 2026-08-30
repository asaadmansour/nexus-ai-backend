import { QueryRunner } from 'typeorm';
import { AddSubmissionIdempotency1789000000000 } from './migrations/1789000000000-AddSubmissionIdempotency';

describe('AddSubmissionIdempotency1789000000000', () => {
  it('adds a unique request key for recoverable submission retries', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddSubmissionIdempotency1789000000000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls
      .map(([statement]: [string]) => statement)
      .join('\n');
    expect(statements).toContain('ADD COLUMN "idempotency_key" uuid');
    expect(statements).toContain('project_submissions_create_request_uidx');
    expect(statements).toContain('WHERE "idempotency_key" IS NOT NULL');
  });
});
