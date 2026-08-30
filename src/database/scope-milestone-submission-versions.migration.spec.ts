import { QueryRunner } from 'typeorm';
import { ScopeMilestoneSubmissionVersions1788900000000 } from './migrations/1788900000000-ScopeMilestoneSubmissionVersions';

describe('ScopeMilestoneSubmissionVersions1788900000000', () => {
  it('excludes task submissions from milestone-level version uniqueness', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new ScopeMilestoneSubmissionVersions1788900000000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls
      .map(([statement]: [string]) => statement)
      .join('\n');
    expect(statements).toContain(
      'DROP INDEX IF EXISTS "project_submissions_milestone_freelancer_version_uidx"',
    );
    expect(statements).toContain('WHERE "task_id" IS NULL');
    expect(statements).toContain(
      'ON "project_submissions" ("milestone_id", "freelancer_profile_id", "version")',
    );
  });
});
