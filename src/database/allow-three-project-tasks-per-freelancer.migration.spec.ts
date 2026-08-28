import { QueryRunner } from 'typeorm';
import { AllowThreeProjectTasksPerFreelancer1788200000000 } from './migrations/1788200000000-AllowThreeProjectTasksPerFreelancer';

describe('AllowThreeProjectTasksPerFreelancer1788200000000', () => {
  it('replaces the global active-invitation uniqueness rule', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AllowThreeProjectTasksPerFreelancer1788200000000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls
      .map(([statement]: [string]) => statement)
      .join('\n');
    expect(statements).toContain(
      'DROP INDEX IF EXISTS "project_invitations_active_profile_uidx"',
    );
    expect(statements).toContain(
      'project_invitations_active_profile_project_idx',
    );
    expect(statements).not.toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "project_invitations_active_profile_project_idx"',
    );
  });
});
