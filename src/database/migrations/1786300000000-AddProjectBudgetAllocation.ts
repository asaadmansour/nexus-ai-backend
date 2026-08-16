import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectBudgetAllocation1786300000000 implements MigrationInterface {
  name = 'AddProjectBudgetAllocation1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects" ADD COLUMN "budget_allocation" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_role_assignments"
       ADD COLUMN "budget_amount" numeric(12,2),
       ADD COLUMN "currency" char(3),
       ADD COLUMN "estimated_hours" integer,
       ADD CONSTRAINT "project_role_assignments_budget_ck"
       CHECK (
         ("budget_amount" IS NULL AND "currency" IS NULL AND "estimated_hours" IS NULL)
         OR ("budget_amount" >= 0 AND "currency" IS NOT NULL AND "estimated_hours" > 0)
       )`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_release_requests"
       ADD COLUMN "planning_submission_id" uuid,
       ADD COLUMN "role_assignment_id" uuid,
       ADD CONSTRAINT "payment_release_requests_planning_submission_fk"
         FOREIGN KEY ("planning_submission_id") REFERENCES "project_planning_submissions"("id") ON DELETE SET NULL,
       ADD CONSTRAINT "payment_release_requests_role_assignment_fk"
         FOREIGN KEY ("role_assignment_id") REFERENCES "project_role_assignments"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "payment_release_requests_pending_planning_submission_uidx"
       ON "payment_release_requests" ("planning_submission_id", "freelancer_profile_id")
       WHERE "planning_submission_id" IS NOT NULL
         AND "freelancer_profile_id" IS NOT NULL
         AND "status" IN ('pending', 'approved')`,
    );

    // Existing quotes receive the same deterministic envelope as new quotes.
    // Standard effort is used because historic rows predate the complexity
    // snapshot; future quotes persist the assessed complexity explicitly.
    await queryRunner.query(
      `UPDATE "projects"
       SET "budget_allocation" = jsonb_build_object(
         'version', 1,
         'strategy', 'planning_25_25_implementation_50',
         'totalAmount', to_char("quoted_amount", 'FM9999999990.00'),
         'currency', upper(COALESCE("quoted_currency", "currency")),
         'complexity', 'standard',
         'planning', jsonb_build_object(
           'architect', jsonb_build_object(
             'percentage', 25,
             'amount', to_char(round("quoted_amount" * 0.25, 2), 'FM9999999990.00'),
             'estimatedHours', 16,
             'maxHourlyRate', to_char(floor(round("quoted_amount" * 0.25, 2) * 100 / 16) / 100, 'FM9999999990.00')
           ),
           'ui_ux', jsonb_build_object(
             'percentage', 25,
             'amount', to_char(round("quoted_amount" * 0.25, 2), 'FM9999999990.00'),
             'estimatedHours', 16,
             'maxHourlyRate', to_char(floor(round("quoted_amount" * 0.25, 2) * 100 / 16) / 100, 'FM9999999990.00')
           )
         ),
         'implementation', jsonb_build_object(
           'percentage', 50,
           'amount', to_char(
             "quoted_amount" - round("quoted_amount" * 0.25, 2) - round("quoted_amount" * 0.25, 2),
             'FM9999999990.00'
           )
         ),
         'generatedAt', COALESCE("quote_generated_at", "updated_at")
       )
       WHERE "quoted_amount" IS NOT NULL AND "quoted_amount" > 0`,
    );

    await queryRunner.query(
      `UPDATE "project_role_assignments" assignment
       SET "budget_amount" = allocation.amount::numeric,
           "currency" = allocation.currency,
           "estimated_hours" = allocation.estimated_hours
       FROM (
         SELECT
           role.id,
           project."budget_allocation" #>> ARRAY['planning', role."role_key", 'amount'] AS amount,
           project."budget_allocation" ->> 'currency' AS currency,
           (project."budget_allocation" #>> ARRAY['planning', role."role_key", 'estimatedHours'])::integer AS estimated_hours
         FROM "project_role_assignments" role
         INNER JOIN "projects" project ON project.id = role."project_id"
         WHERE role."phase" = 'planning'
           AND role."role_key" IN ('architect', 'ui_ux')
           AND project."budget_allocation" IS NOT NULL
       ) allocation
       WHERE assignment.id = allocation.id`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "payment_release_requests_pending_planning_submission_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_release_requests"
       DROP CONSTRAINT IF EXISTS "payment_release_requests_role_assignment_fk",
       DROP CONSTRAINT IF EXISTS "payment_release_requests_planning_submission_fk",
       DROP COLUMN IF EXISTS "role_assignment_id",
       DROP COLUMN IF EXISTS "planning_submission_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_role_assignments"
       DROP CONSTRAINT IF EXISTS "project_role_assignments_budget_ck",
       DROP COLUMN IF EXISTS "estimated_hours",
       DROP COLUMN IF EXISTS "currency",
       DROP COLUMN IF EXISTS "budget_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "budget_allocation"`,
    );
  }
}
