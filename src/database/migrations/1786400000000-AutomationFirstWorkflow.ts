import { MigrationInterface, QueryRunner } from 'typeorm';

export class AutomationFirstWorkflow1786400000000 implements MigrationInterface {
  name = 'AutomationFirstWorkflow1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users"
       ADD COLUMN "is_phone_verified" boolean NOT NULL DEFAULT false,
       ADD COLUMN "phone_verified_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN "recommended_hourly_rate" numeric(8,2),
       ADD COLUMN "hourly_rate_assessed_at" timestamptz,
       ADD COLUMN "performance_score" numeric(5,2) NOT NULL DEFAULT 100,
       ADD COLUMN "completed_tasks" integer NOT NULL DEFAULT 0,
       ADD COLUMN "approved_submissions" integer NOT NULL DEFAULT 0,
       ADD COLUMN "rejected_submissions" integer NOT NULL DEFAULT 0,
       ADD COLUMN "on_time_deliveries" integer NOT NULL DEFAULT 0,
       ADD COLUMN "late_deliveries" integer NOT NULL DEFAULT 0,
       ADD COLUMN "missed_deadlines" integer NOT NULL DEFAULT 0,
       ADD COLUMN "project_removals" integer NOT NULL DEFAULT 0,
       ADD COLUMN "risk_flags" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN "automation_status" varchar(60) NOT NULL DEFAULT 'awaiting_funding',
       ADD COLUMN "platform_fee_amount" numeric(12,2) NOT NULL DEFAULT 0,
       ADD COLUMN "principal_reviewer_assignment_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       ADD COLUMN "penalty_amount" numeric(12,2) NOT NULL DEFAULT 0,
       ADD COLUMN "deadline_strikes" integer NOT NULL DEFAULT 0,
       ADD COLUMN "max_deadline_strikes" integer NOT NULL DEFAULT 2,
       ADD COLUMN "assignment_status" varchar(40) NOT NULL DEFAULT 'unassigned'`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"
       ADD COLUMN "type" varchar(60) NOT NULL DEFAULT 'general',
       ADD COLUMN "action_url" text,
       ADD COLUMN "metadata" jsonb`,
    );

    await queryRunner.query(
      `CREATE TABLE "phone_verification_challenges" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "phone_number" varchar(20) NOT NULL,
        "provider" varchar(40) NOT NULL DEFAULT 'twilio_verify',
        "provider_request_id" varchar(120),
        "status" varchar(40) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "expires_at" timestamptz NOT NULL,
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "phone_verification_challenges_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "phone_verification_challenges_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "phone_verification_challenges_user_created_idx" ON "phone_verification_challenges" ("user_id", "created_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "project_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" uuid NOT NULL,
        "task_id" uuid,
        "freelancer_profile_id" uuid NOT NULL,
        "matching_run_id" uuid,
        "candidate_id" uuid,
        "phase" varchar(40) NOT NULL,
        "role_key" varchar(80) NOT NULL,
        "status" varchar(40) NOT NULL DEFAULT 'pending',
        "rank_snapshot" integer,
        "score_snapshot" jsonb,
        "expires_at" timestamptz NOT NULL,
        "responded_at" timestamptz,
        "response_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "project_invitations_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "project_invitations_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "project_invitations_task_fk" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "project_invitations_profile_fk" FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "project_invitations_run_fk" FOREIGN KEY ("matching_run_id") REFERENCES "matching_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "project_invitations_candidate_fk" FOREIGN KEY ("candidate_id") REFERENCES "matching_candidates"("id") ON DELETE SET NULL,
        CONSTRAINT "project_invitations_phase_ck" CHECK ("phase" IN ('governance', 'planning', 'implementation')),
        CONSTRAINT "project_invitations_status_ck" CHECK ("status" IN ('pending', 'accepting', 'accepted', 'declined', 'expired', 'cancelled'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "project_invitations_user_status_idx" ON "project_invitations" ("freelancer_profile_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "project_invitations_expiry_idx" ON "project_invitations" ("status", "expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "project_invitations_project_phase_idx" ON "project_invitations" ("project_id", "phase", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_invitations_pending_target_uidx"
       ON "project_invitations" ("project_id", "phase", "role_key", COALESCE("task_id", '00000000-0000-0000-0000-000000000000'::uuid))
       WHERE "status" IN ('pending', 'accepting')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_invitations_pending_run_uidx"
       ON "project_invitations" ("matching_run_id")
       WHERE "matching_run_id" IS NOT NULL AND "status" IN ('pending', 'accepting')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_invitations_pending_task_uidx"
       ON "project_invitations" ("task_id")
       WHERE "task_id" IS NOT NULL AND "status" IN ('pending', 'accepting')`,
    );

    await queryRunner.query(
      `CREATE TABLE "task_checkpoints" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "task_id" uuid NOT NULL,
        "title" varchar(180) NOT NULL,
        "order_index" integer NOT NULL,
        "due_at" timestamptz NOT NULL,
        "weight_percent" numeric(5,2) NOT NULL,
        "penalty_percent" numeric(5,2) NOT NULL,
        "grace_minutes" integer NOT NULL DEFAULT 60,
        "status" varchar(40) NOT NULL DEFAULT 'pending',
        "completed_at" timestamptz,
        "assessed_at" timestamptz,
        "penalty_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "task_checkpoints_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "task_checkpoints_task_fk" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "task_checkpoints_weight_ck" CHECK ("weight_percent" > 0 AND "weight_percent" <= 100),
        CONSTRAINT "task_checkpoints_penalty_ck" CHECK ("penalty_percent" >= 0 AND "penalty_percent" <= 100)
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "task_checkpoints_due_status_idx" ON "task_checkpoints" ("status", "due_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "task_checkpoints_task_order_uidx" ON "task_checkpoints" ("task_id", "order_index")`,
    );

    await queryRunner.query(
      `CREATE TABLE "freelancer_performance_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "freelancer_profile_id" uuid NOT NULL,
        "project_id" uuid,
        "task_id" uuid,
        "event_type" varchar(60) NOT NULL,
        "score_delta" numeric(6,2) NOT NULL DEFAULT 0,
        "money_delta" numeric(12,2) NOT NULL DEFAULT 0,
        "currency" char(3),
        "reason" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "freelancer_performance_events_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "freelancer_performance_events_profile_fk" FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "freelancer_performance_events_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL,
        CONSTRAINT "freelancer_performance_events_task_fk" FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "freelancer_performance_events_profile_created_idx" ON "freelancer_performance_events" ("freelancer_profile_id", "created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "projects_principal_reviewer_assignment_fk" FOREIGN KEY ("principal_reviewer_assignment_id") REFERENCES "project_role_assignments"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "escrow_ledger_entries_payment_hold_uidx"
       ON "escrow_ledger_entries" ("payment_id")
       WHERE "payment_id" IS NOT NULL AND "entry_type" = 'hold' AND "status" = 'posted'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "escrow_ledger_entries_project_platform_fee_uidx"
       ON "escrow_ledger_entries" ("project_id")
       WHERE "entry_type" = 'platform_fee' AND "status" = 'posted'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "escrow_ledger_entries_project_governance_release_uidx"
       ON "escrow_ledger_entries" ("project_id")
       WHERE "entry_type" = 'governance_release' AND "status" = 'posted'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "escrow_ledger_entries_payment_hold_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "escrow_ledger_entries_project_governance_release_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "escrow_ledger_entries_project_platform_fee_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_principal_reviewer_assignment_fk"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "freelancer_performance_events"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "task_checkpoints"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_invitations"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "phone_verification_challenges"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN IF EXISTS "metadata", DROP COLUMN IF EXISTS "action_url", DROP COLUMN IF EXISTS "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "assignment_status", DROP COLUMN IF EXISTS "max_deadline_strikes", DROP COLUMN IF EXISTS "deadline_strikes", DROP COLUMN IF EXISTS "penalty_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "principal_reviewer_assignment_id", DROP COLUMN IF EXISTS "platform_fee_amount", DROP COLUMN IF EXISTS "automation_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles" DROP COLUMN IF EXISTS "risk_flags", DROP COLUMN IF EXISTS "project_removals", DROP COLUMN IF EXISTS "missed_deadlines", DROP COLUMN IF EXISTS "late_deliveries", DROP COLUMN IF EXISTS "on_time_deliveries", DROP COLUMN IF EXISTS "rejected_submissions", DROP COLUMN IF EXISTS "approved_submissions", DROP COLUMN IF EXISTS "completed_tasks", DROP COLUMN IF EXISTS "performance_score", DROP COLUMN IF EXISTS "hourly_rate_assessed_at", DROP COLUMN IF EXISTS "recommended_hourly_rate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_verified_at", DROP COLUMN IF EXISTS "is_phone_verified"`,
    );
  }
}
