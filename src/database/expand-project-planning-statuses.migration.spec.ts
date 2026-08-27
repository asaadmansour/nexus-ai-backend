import { QueryRunner } from 'typeorm';
import { ExpandProjectPlanningStatuses1788100000000 } from './migrations/1788100000000-ExpandProjectPlanningStatuses';

describe('ExpandProjectPlanningStatuses1788100000000', () => {
  it('allows the team-before-funding planning statuses', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new ExpandProjectPlanningStatuses1788100000000();

    await migration.up({ query } as unknown as QueryRunner);

    const statements = query.mock.calls
      .map(([statement]: [string]) => statement)
      .join('\n');
    expect(statements).toContain('projects_planning_status_check');
    expect(statements).toContain("'team_confirmed'");
    expect(statements).toContain("'waiting_for_pr'");
  });
});
