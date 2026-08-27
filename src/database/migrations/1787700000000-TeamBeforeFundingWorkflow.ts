import { MigrationInterface, QueryRunner } from 'typeorm';

export class TeamBeforeFundingWorkflow1787700000000 implements MigrationInterface {
  name = 'TeamBeforeFundingWorkflow1787700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "project_status" ADD VALUE IF NOT EXISTS 'waiting_for_pr'`,
    );
    await queryRunner.query(
      `ALTER TYPE "project_status" ADD VALUE IF NOT EXISTS 'ready_for_funding'`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "staffing_deadline" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations"
       ADD COLUMN IF NOT EXISTS "notification_status" varchar(20) NOT NULL DEFAULT 'pending',
       ADD COLUMN IF NOT EXISTS "notification_attempts" integer NOT NULL DEFAULT 0,
       ADD COLUMN IF NOT EXISTS "notification_error" text,
       ADD COLUMN IF NOT EXISTS "notification_sent_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations"
       ADD CONSTRAINT "project_invitations_notification_status_ck"
       CHECK ("notification_status" IN ('pending', 'sending', 'sent', 'failed')) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations"
       ADD CONSTRAINT "project_invitations_notification_attempts_ck"
       CHECK ("notification_attempts" >= 0) NOT VALID`,
    );

    // Governance assignments have been in the application model since the
    // principal-reviewer workflow was introduced, but older databases still
    // retained the planning/implementation-only check.
    await queryRunner.query(
      `ALTER TABLE "project_role_assignments" DROP CONSTRAINT IF EXISTS "project_role_assignments_phase_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_phase_check"
       CHECK ("phase" IN ('governance', 'planning', 'staffing', 'implementation')) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations" DROP CONSTRAINT IF EXISTS "project_invitations_phase_ck"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations"
       ADD CONSTRAINT "project_invitations_phase_ck"
       CHECK ("phase" IN ('governance', 'planning', 'staffing', 'implementation')) NOT VALID`,
    );

    // Older/manual retries could start a second run for the same planning role.
    // Keep the oldest live invitation for that project role and make every
    // superseded run/candidate explicitly retryable before adding the unique
    // database backstop.
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id", "matching_run_id", "candidate_id",
                ROW_NUMBER() OVER (
                  PARTITION BY "project_id", "phase", "role_key"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "task_id" IS NULL
           AND "status" IN ('pending', 'accepting')
       )
       UPDATE "matching_candidates" candidate
       SET "status" = 'recommended',
           "rejection_reason" = NULL,
           "updated_at" = NOW()
       FROM ranked
       WHERE ranked.rn > 1
         AND ranked."candidate_id" IS NOT NULL
         AND candidate."id" = ranked."candidate_id"
         AND candidate."status" = 'invited'`,
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id", "matching_run_id",
                ROW_NUMBER() OVER (
                  PARTITION BY "project_id", "phase", "role_key"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "task_id" IS NULL
           AND "status" IN ('pending', 'accepting')
       )
       UPDATE "matching_runs" run
       SET "status" = 'failed',
           "error" = 'Superseded duplicate role invitation; automation will retry',
           "completed_at" = NOW(),
           "updated_at" = NOW()
       FROM ranked
       WHERE ranked.rn > 1
         AND ranked."matching_run_id" IS NOT NULL
         AND run."id" = ranked."matching_run_id"
         AND run."status" NOT IN ('cancelled', 'failed')`,
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                ROW_NUMBER() OVER (
                  PARTITION BY "project_id", "phase", "role_key"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "task_id" IS NULL
           AND "status" IN ('pending', 'accepting')
       )
       UPDATE "project_invitations" invitation
       SET "status" = 'cancelled',
           "responded_at" = COALESCE("responded_at", NOW()),
           "response_reason" = COALESCE(
             "response_reason",
             'Superseded while enforcing one active invitation per project role'
           ),
           "updated_at" = NOW()
       FROM ranked
       WHERE invitation."id" = ranked."id" AND ranked.rn > 1`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_invitations_active_role_uidx"
       ON "project_invitations" ("project_id", "phase", "role_key")
       WHERE "task_id" IS NULL
         AND "status" IN ('pending', 'accepting')`,
    );

    // A freelancer can only hold one live invitation at a time. Together with
    // the profile row lock in matching this is the database backstop against
    // two projects reserving the same person concurrently.
    // Existing duplicates are made recoverable before cancellation: their
    // candidate is returned to the pool and the affected run is failed so the
    // automation monitor can start a fresh run instead of treating it as done.
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id", "matching_run_id", "candidate_id",
                ROW_NUMBER() OVER (
                  PARTITION BY "freelancer_profile_id"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "status" IN ('pending', 'accepting')
       )
       UPDATE "matching_candidates" candidate
       SET "status" = 'recommended',
           "rejection_reason" = NULL,
           "updated_at" = NOW()
       FROM ranked
       WHERE ranked.rn > 1
         AND ranked."candidate_id" IS NOT NULL
         AND candidate."id" = ranked."candidate_id"
         AND candidate."status" = 'invited'`,
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id", "matching_run_id",
                ROW_NUMBER() OVER (
                  PARTITION BY "freelancer_profile_id"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "status" IN ('pending', 'accepting')
       )
       UPDATE "matching_runs" run
       SET "status" = 'failed',
           "error" = 'Superseded duplicate invitation; automation will retry',
           "completed_at" = NOW(),
           "updated_at" = NOW()
       FROM ranked
       WHERE ranked.rn > 1
         AND ranked."matching_run_id" IS NOT NULL
         AND run."id" = ranked."matching_run_id"
         AND run."status" NOT IN ('cancelled', 'failed')`,
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                ROW_NUMBER() OVER (
                  PARTITION BY "freelancer_profile_id"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "status" IN ('pending', 'accepting')
       )
       UPDATE "project_invitations" invitation
       SET "status" = 'cancelled',
           "responded_at" = COALESCE("responded_at", NOW()),
           "response_reason" = COALESCE(
             "response_reason",
             'Superseded while enforcing one active invitation per freelancer'
           ),
           "updated_at" = NOW()
       FROM ranked
       WHERE invitation."id" = ranked."id" AND ranked.rn > 1`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_invitations_active_profile_uidx"
       ON "project_invitations" ("freelancer_profile_id")
       WHERE "status" IN ('pending', 'accepting')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_invitations_active_role_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_invitations_active_profile_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_role_assignments" DROP CONSTRAINT IF EXISTS "project_role_assignments_phase_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations" DROP CONSTRAINT IF EXISTS "project_invitations_phase_ck"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations"
       ADD CONSTRAINT "project_invitations_phase_ck"
       CHECK ("phase" IN ('governance', 'planning', 'implementation')) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_phase_check"
       CHECK ("phase" IN ('planning', 'implementation')) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "staffing_deadline"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations" DROP CONSTRAINT IF EXISTS "project_invitations_notification_attempts_ck"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations" DROP CONSTRAINT IF EXISTS "project_invitations_notification_status_ck"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_invitations"
       DROP COLUMN IF EXISTS "notification_sent_at",
       DROP COLUMN IF EXISTS "notification_error",
       DROP COLUMN IF EXISTS "notification_attempts",
       DROP COLUMN IF EXISTS "notification_status"`,
    );
    // PostgreSQL enum values are intentionally retained on rollback because
    // removing values requires rebuilding the enum and can corrupt live rows.
  }
}
