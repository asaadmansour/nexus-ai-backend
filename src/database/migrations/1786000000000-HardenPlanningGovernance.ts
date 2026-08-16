import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPlanningGovernance1786000000000 implements MigrationInterface {
  name = 'HardenPlanningGovernance1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN "evaluation_audit_bundle" jsonb,
       ADD COLUMN "ai_override" boolean NOT NULL DEFAULT false,
       ADD COLUMN "ai_override_reason" text,
       ADD COLUMN "ai_overridden_by" uuid,
       ADD COLUMN "ai_overridden_at" timestamptz`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_role_assignments_planning_freelancer_uidx"
       ON "project_role_assignments" ("project_id", "freelancer_profile_id")
       WHERE "phase" = 'planning'
         AND "status" IN ('assigned', 'accepted', 'in_progress', 'completed')`,
    );
    await queryRunner.query(
      `CREATE INDEX "agent_jobs_active_updated_idx"
       ON "agent_jobs" ("status", "updated_at")
       WHERE "status" IN ('queued', 'retrying', 'running')`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_ai_override_fk"
       FOREIGN KEY ("ai_overridden_by") REFERENCES "users"("id")
       ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_ai_override_ck"
       CHECK (
         ("ai_override" = false AND "ai_override_reason" IS NULL AND "ai_overridden_by" IS NULL AND "ai_overridden_at" IS NULL)
         OR
         ("ai_override" = true AND length(trim("ai_override_reason")) >= 20 AND "ai_overridden_by" IS NOT NULL AND "ai_overridden_at" IS NOT NULL)
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_role_assignments_planning_freelancer_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_active_updated_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_ai_override_ck",
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_ai_override_fk",
       DROP COLUMN IF EXISTS "ai_overridden_at",
       DROP COLUMN IF EXISTS "ai_overridden_by",
       DROP COLUMN IF EXISTS "ai_override_reason",
       DROP COLUMN IF EXISTS "ai_override",
       DROP COLUMN IF EXISTS "evaluation_audit_bundle"`,
    );
  }
}
