import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessInvariantConstraints1787600000000 implements MigrationInterface {
  name = 'AddBusinessInvariantConstraints1787600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const checks: Array<[string, string, string]> = [
      [
        'projects',
        'CHK_projects_budget_range',
        '"budget_min" >= 0 AND "budget_max" > 0 AND "budget_min" <= "budget_max"',
      ],
      [
        'projects',
        'CHK_projects_money_nonnegative',
        '"held_amount" >= 0 AND "released_amount" >= 0 AND "platform_fee_amount" >= 0 AND ("quoted_amount" IS NULL OR "quoted_amount" > 0)',
      ],
      [
        'project_milestones',
        'CHK_project_milestones_schedule',
        '"starts_at" IS NULL OR "due_at" IS NULL OR "due_at" > "starts_at"',
      ],
      [
        'project_milestones',
        'CHK_project_milestones_budget',
        '"budget_amount" IS NULL OR "budget_amount" >= 0',
      ],
      [
        'project_tasks',
        'CHK_project_tasks_schedule',
        '"starts_at" IS NULL OR "due_at" IS NULL OR "due_at" > "starts_at"',
      ],
      [
        'project_tasks',
        'CHK_project_tasks_effort_money',
        '("estimated_hours" IS NULL OR "estimated_hours" > 0) AND ("budget_amount" IS NULL OR "budget_amount" > 0) AND "penalty_amount" >= 0',
      ],
      [
        'project_tasks',
        'CHK_project_tasks_deadline_strikes',
        '"deadline_strikes" >= 0 AND "max_deadline_strikes" > 0 AND "deadline_strikes" <= "max_deadline_strikes"',
      ],
      [
        'task_checkpoints',
        'CHK_task_checkpoints_percentages',
        '"weight_percent" >= 0 AND "weight_percent" <= 100 AND "penalty_percent" >= 0 AND "penalty_percent" <= 100',
      ],
      [
        'task_checkpoints',
        'CHK_task_checkpoints_values',
        '"grace_minutes" >= 0 AND "penalty_amount" >= 0',
      ],
      [
        'project_revision_requests',
        'CHK_project_revision_requests_due',
        '"due_at" IS NULL OR "due_at" > "created_at"',
      ],
      [
        'project_invitations',
        'CHK_project_invitations_expiry',
        '"expires_at" > "created_at"',
      ],
      [
        'brief_documents',
        'CHK_brief_documents_size',
        '"size_bytes" > 0 AND "size_bytes" <= 10485760',
      ],
      [
        'brief_documents',
        'CHK_brief_documents_attempts',
        '"processing_attempts" >= 0',
      ],
    ];
    for (const [table, name, expression] of checks) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expression}) NOT VALID`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const constraints: Array<[string, string]> = [
      ['brief_documents', 'CHK_brief_documents_attempts'],
      ['brief_documents', 'CHK_brief_documents_size'],
      ['project_invitations', 'CHK_project_invitations_expiry'],
      ['project_revision_requests', 'CHK_project_revision_requests_due'],
      ['task_checkpoints', 'CHK_task_checkpoints_values'],
      ['task_checkpoints', 'CHK_task_checkpoints_percentages'],
      ['project_tasks', 'CHK_project_tasks_deadline_strikes'],
      ['project_tasks', 'CHK_project_tasks_effort_money'],
      ['project_tasks', 'CHK_project_tasks_schedule'],
      ['project_milestones', 'CHK_project_milestones_budget'],
      ['project_milestones', 'CHK_project_milestones_schedule'],
      ['projects', 'CHK_projects_money_nonnegative'],
      ['projects', 'CHK_projects_budget_range'],
    ];
    for (const [table, name] of constraints) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`,
      );
    }
  }
}
