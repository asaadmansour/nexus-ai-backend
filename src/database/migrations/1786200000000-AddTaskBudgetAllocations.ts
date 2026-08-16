import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskBudgetAllocations1786200000000 implements MigrationInterface {
  name = 'AddTaskBudgetAllocations1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       ADD COLUMN "budget_amount" numeric(12,2),
       ADD COLUMN "currency" char(3),
       ADD CONSTRAINT "project_tasks_budget_allocation_ck"
       CHECK (
         ("budget_amount" IS NULL AND "currency" IS NULL)
         OR ("budget_amount" >= 0 AND "currency" IS NOT NULL)
       )`,
    );

    await queryRunner.query(
      `WITH weighted AS (
         SELECT
           task.id,
           milestone.id AS milestone_id,
           milestone.budget_amount,
           COALESCE(milestone.currency, project.quoted_currency, project.currency) AS currency,
           GREATEST(COALESCE(NULLIF(task.estimated_hours, 0), 1), 0.01) AS weight,
           SUM(GREATEST(COALESCE(NULLIF(task.estimated_hours, 0), 1), 0.01))
             OVER (PARTITION BY milestone.id) AS total_weight
         FROM project_tasks task
         INNER JOIN project_milestones milestone ON milestone.id = task.milestone_id
         INNER JOIN projects project ON project.id = task.project_id
         WHERE milestone.budget_amount IS NOT NULL
           AND milestone.budget_amount >= 0
       ), raw_shares AS (
         SELECT
           id,
           milestone_id,
           currency,
           FLOOR(ROUND(budget_amount * 100) * weight / total_weight)::bigint AS base_cents,
           (ROUND(budget_amount * 100) * weight / total_weight)
             - FLOOR(ROUND(budget_amount * 100) * weight / total_weight) AS fraction,
           ROUND(budget_amount * 100)::bigint AS total_cents
         FROM weighted
       ), ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (
             PARTITION BY milestone_id
             ORDER BY fraction DESC, id
           ) AS fraction_rank,
           SUM(base_cents) OVER (
             PARTITION BY milestone_id
           ) AS allocated_base_cents
         FROM raw_shares
       ), allocations AS (
         SELECT
           id,
           currency,
           base_cents + CASE
             WHEN fraction_rank <= total_cents - allocated_base_cents THEN 1
             ELSE 0
           END AS allocated_cents
         FROM ranked
       )
       UPDATE project_tasks task
       SET budget_amount = allocations.allocated_cents::numeric / 100,
           currency = allocations.currency
       FROM allocations
       WHERE task.id = allocations.id`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "payment_release_requests_pending_milestone_uidx"`,
    );
    await queryRunner.query(
      `CREATE INDEX "payment_release_requests_milestone_freelancer_status_idx"
       ON "payment_release_requests" ("milestone_id", "freelancer_profile_id", "status")
       WHERE "milestone_id" IS NOT NULL AND "freelancer_profile_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "payment_release_requests_milestone_freelancer_status_idx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "payment_release_requests_pending_milestone_uidx"
       ON "payment_release_requests" ("milestone_id", "freelancer_profile_id")
       WHERE "milestone_id" IS NOT NULL
         AND "freelancer_profile_id" IS NOT NULL
         AND "status" IN ('pending', 'approved')`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       DROP CONSTRAINT IF EXISTS "project_tasks_budget_allocation_ck",
       DROP COLUMN IF EXISTS "currency",
       DROP COLUMN IF EXISTS "budget_amount"`,
    );
  }
}
