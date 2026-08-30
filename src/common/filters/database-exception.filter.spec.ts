import { uniqueConstraintMessage } from './database-exception.filter';

describe('DatabaseExceptionFilter', () => {
  it('makes submission uniqueness conflicts recoverable', () => {
    expect(
      uniqueConstraintMessage({
        constraint: 'project_submissions_task_freelancer_version_uidx',
      }),
    ).toContain('Refresh the task');
    expect(
      uniqueConstraintMessage({
        constraint: 'project_submissions_create_request_uidx',
      }),
    ).toContain('no work was lost');
  });
});
