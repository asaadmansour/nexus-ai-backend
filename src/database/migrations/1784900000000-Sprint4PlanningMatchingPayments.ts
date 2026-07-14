import { MigrationInterface, QueryRunner } from 'typeorm';

export class Sprint4PlanningMatchingPayments1784900000000 implements MigrationInterface {
  name = 'Sprint4PlanningMatchingPayments1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const status of [
      'planning_matching',
      'planning_assigned',
      'planning_in_progress',
      'planning_review',
      'implementation_ready',
      'matching',
      'matched',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "project_status" ADD VALUE IF NOT EXISTS '${status}'`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "users"
       ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users"
       ADD COLUMN IF NOT EXISTS "stripe_default_payment_method_id" varchar(255)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "users_stripe_customer_id_uidx"
       ON "users" ("stripe_customer_id")
       WHERE "stripe_customer_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "stripe_account_id" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "stripe_onboarding_status" varchar(40) NOT NULL DEFAULT 'not_started'`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "stripe_requirements_due" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "stripe_onboarded_at" timestamptz`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "freelancer_profiles_stripe_account_id_uidx"
       ON "freelancer_profiles" ("stripe_account_id")
       WHERE "stripe_account_id" IS NOT NULL`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_profiles_stripe_onboarding_status_check',
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_stripe_onboarding_status_check"
       CHECK (
         "stripe_onboarding_status" IN (
           'not_started',
           'link_created',
           'in_progress',
           'completed',
           'restricted',
           'disabled'
         )
       )`,
    );

    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "planning_status" varchar(40) NOT NULL DEFAULT 'not_started'`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "planning_started_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "planning_completed_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "implementation_ready_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "assigned_at" timestamptz`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'projects_planning_status_check',
      `ALTER TABLE "projects"
       ADD CONSTRAINT "projects_planning_status_check"
       CHECK (
         "planning_status" IN (
           'not_started',
           'matching',
           'assigned',
           'in_progress',
           'under_review',
           'approved',
           'changes_requested',
           'completed',
           'cancelled'
         )
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "projects_planning_status_idx"
       ON "projects" ("planning_status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "matching_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "target_type" varchar(40) NOT NULL,
        "target_role_key" varchar(80),
        "target_task_id" uuid,
        "status" varchar(40) NOT NULL DEFAULT 'queued',
        "requested_by" uuid,
        "filters" jsonb,
        "input_snapshot" jsonb,
        "summary" text,
        "error" text,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'matching_runs_target_type_check',
      `ALTER TABLE "matching_runs"
       ADD CONSTRAINT "matching_runs_target_type_check"
       CHECK ("target_type" IN ('planning_role', 'implementation_team', 'task'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'matching_runs_status_check',
      `ALTER TABLE "matching_runs"
       ADD CONSTRAINT "matching_runs_status_check"
       CHECK (
         "status" IN (
           'queued',
           'running',
           'completed',
           'failed',
           'reviewed',
           'cancelled'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "matching_candidates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "matching_run_id" uuid NOT NULL,
        "freelancer_profile_id" uuid,
        "rank" int NOT NULL,
        "score" numeric(6,2) NOT NULL,
        "score_breakdown" jsonb,
        "rationale" text,
        "evidence" jsonb,
        "status" varchar(40) NOT NULL DEFAULT 'recommended',
        "selected_by" uuid,
        "selected_at" timestamptz,
        "rejection_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("rank" > 0),
        CHECK ("score" >= 0 AND "score" <= 100)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'matching_candidates_status_check',
      `ALTER TABLE "matching_candidates"
       ADD CONSTRAINT "matching_candidates_status_check"
       CHECK (
         "status" IN (
           'recommended',
           'shortlisted',
           'selected',
           'rejected',
           'assigned'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_role_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "freelancer_profile_id" uuid,
        "phase" varchar(40) NOT NULL,
        "role_key" varchar(80) NOT NULL,
        "status" varchar(40) NOT NULL DEFAULT 'assigned',
        "source_matching_run_id" uuid,
        "source_candidate_id" uuid,
        "assigned_by" uuid,
        "hourly_rate_snapshot" numeric(8,2),
        "availability_hours_snapshot" int,
        "score_snapshot" jsonb,
        "decision_reason" text,
        "notes" text,
        "assigned_at" timestamptz,
        "accepted_at" timestamptz,
        "declined_at" timestamptz,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "ended_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("availability_hours_snapshot" IS NULL OR "availability_hours_snapshot" >= 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_role_assignments_phase_check',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_phase_check"
       CHECK ("phase" IN ('planning', 'implementation'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_role_assignments_status_check',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_status_check"
       CHECK (
         "status" IN (
           'recommended',
           'assigned',
           'accepted',
           'declined',
           'in_progress',
           'completed',
           'cancelled',
           'replaced'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_planning_submissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "assignment_id" uuid,
        "freelancer_profile_id" uuid,
        "submission_type" varchar(40) NOT NULL,
        "version" int NOT NULL DEFAULT 1,
        "status" varchar(40) NOT NULL DEFAULT 'draft',
        "title" varchar(255),
        "summary" text,
        "content" jsonb,
        "file_urls" jsonb,
        "admin_notes" text,
        "submitted_at" timestamptz,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("version" > 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_planning_submissions_type_check',
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_type_check"
       CHECK ("submission_type" IN ('architecture', 'ui_ux'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_planning_submissions_status_check',
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_status_check"
       CHECK (
         "status" IN (
           'draft',
           'submitted',
           'approved',
           'changes_requested',
           'rejected',
           'superseded'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "version" int NOT NULL DEFAULT 1,
        "status" varchar(40) NOT NULL DEFAULT 'generated',
        "is_current" boolean NOT NULL DEFAULT true,
        "architecture_submission_id" uuid,
        "uiux_submission_id" uuid,
        "generated_by_job_id" uuid,
        "summary" text,
        "assumptions" jsonb,
        "timeline" jsonb,
        "milestones" jsonb,
        "tasks" jsonb,
        "dependencies" jsonb,
        "team_plan" jsonb,
        "risk_register" jsonb,
        "admin_notes" text,
        "approved_by" uuid,
        "approved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("version" > 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_plans_status_check',
      `ALTER TABLE "project_plans"
       ADD CONSTRAINT "project_plans_status_check"
       CHECK (
         "status" IN (
           'generated',
           'under_review',
           'approved',
           'changes_requested',
           'rejected',
           'superseded'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_specs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL UNIQUE,
        "approved_plan_id" uuid,
        "architecture" jsonb,
        "design_system" jsonb,
        "api_contract" jsonb,
        "data_model" jsonb,
        "conventions" jsonb,
        "locked_at" timestamptz,
        "approved_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_milestones" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "project_plan_id" uuid,
        "title" varchar(255) NOT NULL,
        "description" text,
        "status" varchar(40) NOT NULL DEFAULT 'planned',
        "order_index" int NOT NULL DEFAULT 0,
        "starts_at" timestamptz,
        "due_at" timestamptz,
        "budget_amount" numeric(12,2),
        "currency" char(3),
        "acceptance_criteria" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("order_index" >= 0),
        CHECK ("budget_amount" IS NULL OR "budget_amount" >= 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_milestones_status_check',
      `ALTER TABLE "project_milestones"
       ADD CONSTRAINT "project_milestones_status_check"
       CHECK (
         "status" IN (
           'planned',
           'funding_required',
           'funded',
           'active',
           'submitted',
           'approved',
           'paid',
           'cancelled'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_tasks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "project_plan_id" uuid,
        "milestone_id" uuid,
        "assignment_id" uuid,
        "assigned_freelancer_profile_id" uuid,
        "title" varchar(255) NOT NULL,
        "description" text,
        "status" varchar(40) NOT NULL DEFAULT 'todo',
        "priority" varchar(40) NOT NULL DEFAULT 'medium',
        "role_key" varchar(80),
        "required_skills" text[],
        "estimated_hours" numeric(8,2),
        "order_index" int NOT NULL DEFAULT 0,
        "starts_at" timestamptz,
        "due_at" timestamptz,
        "acceptance_criteria" jsonb,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("order_index" >= 0),
        CHECK ("estimated_hours" IS NULL OR "estimated_hours" >= 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_tasks_status_check',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_status_check"
       CHECK (
         "status" IN (
           'todo',
           'blocked',
           'in_progress',
           'review',
           'changes_requested',
           'done',
           'cancelled'
         )
       )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_tasks_priority_check',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_priority_check"
       CHECK ("priority" IN ('low', 'medium', 'high', 'urgent'))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_task_dependencies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "depends_on_task_id" uuid NOT NULL,
        "dependency_type" varchar(40) NOT NULL DEFAULT 'blocks',
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("task_id" <> "depends_on_task_id")
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_task_dependencies_type_check',
      `ALTER TABLE "project_task_dependencies"
       ADD CONSTRAINT "project_task_dependencies_type_check"
       CHECK ("dependency_type" IN ('blocks', 'related', 'after'))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "milestone_id" uuid,
        "customer_id" uuid NOT NULL,
        "stripe_payment_intent_id" varchar(255),
        "stripe_checkout_session_id" varchar(255),
        "stripe_invoice_id" varchar(255),
        "amount" numeric(12,2) NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'EGP',
        "status" varchar(40) NOT NULL DEFAULT 'requires_payment',
        "purpose" varchar(60) NOT NULL,
        "metadata" jsonb,
        "paid_at" timestamptz,
        "failed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("amount" >= 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_payments_status_check',
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_status_check"
       CHECK (
         "status" IN (
           'requires_payment',
           'processing',
           'succeeded',
           'failed',
           'cancelled',
           'refunded',
           'partially_refunded'
         )
       )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_payments_purpose_check',
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_purpose_check"
       CHECK (
         "purpose" IN (
           'planning_deposit',
           'milestone_funding',
           'full_project_deposit',
           'change_request',
           'refund_adjustment'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "escrow_ledger_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "payment_id" uuid,
        "milestone_id" uuid,
        "freelancer_profile_id" uuid,
        "entry_type" varchar(40) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'EGP',
        "status" varchar(40) NOT NULL DEFAULT 'pending',
        "reason" text,
        "stripe_transfer_id" varchar(255),
        "stripe_refund_id" varchar(255),
        "created_by" uuid,
        "posted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("amount" >= 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'escrow_ledger_entries_type_check',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_type_check"
       CHECK (
         "entry_type" IN (
           'hold',
           'release',
           'refund',
           'platform_fee',
           'adjustment'
         )
       )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'escrow_ledger_entries_status_check',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_status_check"
       CHECK ("status" IN ('pending', 'posted', 'voided', 'failed'))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stripe_event_id" varchar(255) NOT NULL,
        "event_type" varchar(120) NOT NULL,
        "payload" jsonb NOT NULL,
        "processed_at" timestamptz,
        "processing_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );

    await this.createIndexes(queryRunner);
    await this.createForeignKeys(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_submission_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_task_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_matching_run_id_fk"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_webhook_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "escrow_ledger_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_task_dependencies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_milestones"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_specs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_plans"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "project_planning_submissions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "project_role_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "matching_candidates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "matching_runs"`);

    await queryRunner.query(
      `ALTER TABLE "projects"
       DROP CONSTRAINT IF EXISTS "projects_planning_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "assigned_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "implementation_ready_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "planning_completed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "planning_started_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "planning_status"`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_stripe_onboarding_status_check"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_stripe_account_id_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "stripe_onboarded_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "stripe_requirements_due"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "stripe_payouts_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "stripe_charges_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "stripe_onboarding_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "stripe_account_id"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "users_stripe_customer_id_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users"
       DROP COLUMN IF EXISTS "stripe_default_payment_method_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "stripe_customer_id"`,
    );

    await queryRunner.query(
      `UPDATE "projects"
       SET "status" = 'brief_complete'
       WHERE "status"::text IN (
         'planning_matching',
         'planning_assigned',
         'planning_in_progress',
         'planning_review',
         'implementation_ready',
         'matching',
         'matched'
       )`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "project_status" RENAME TO "project_status_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "project_status" AS ENUM (
        'draft',
        'in_progress',
        'brief_complete',
        'spec_in_progress',
        'spec_under_review',
        'spec_complete',
        'scoped',
        'assigned',
        'active',
        'under_review',
        'completed',
        'cancelled',
        'disputed'
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ALTER COLUMN "status"
       TYPE "project_status"
       USING "status"::text::"project_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
    await queryRunner.query(`DROP TYPE "project_status_old"`);
  }

  private async createIndexes(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "matching_runs_project_status_idx"
       ON "matching_runs" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "matching_runs_target_role_idx"
       ON "matching_runs" ("project_id", "target_type", "target_role_key")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "matching_candidates_run_profile_uidx"
       ON "matching_candidates" ("matching_run_id", "freelancer_profile_id")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "matching_candidates_run_rank_idx"
       ON "matching_candidates" ("matching_run_id", "rank")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "matching_candidates_profile_status_idx"
       ON "matching_candidates" ("freelancer_profile_id", "status")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "matching_candidates_run_score_idx"
       ON "matching_candidates" ("matching_run_id", "score" DESC)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_role_assignments_project_phase_status_idx"
       ON "project_role_assignments" ("project_id", "phase", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_role_assignments_freelancer_status_idx"
       ON "project_role_assignments" ("freelancer_profile_id", "status")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_role_assignments_active_role_uidx"
       ON "project_role_assignments" ("project_id", "phase", "role_key")
       WHERE "ended_at" IS NULL
         AND "status" IN ('assigned', 'accepted', 'in_progress', 'completed')`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_planning_submissions_project_type_status_idx"
       ON "project_planning_submissions" ("project_id", "submission_type", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_planning_submissions_assignment_type_version_uidx"
       ON "project_planning_submissions" ("assignment_id", "submission_type", "version")
       WHERE "assignment_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_plans_project_status_idx"
       ON "project_plans" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_plans_project_version_uidx"
       ON "project_plans" ("project_id", "version")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_plans_current_uidx"
       ON "project_plans" ("project_id")
       WHERE "is_current" = true`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_milestones_project_order_idx"
       ON "project_milestones" ("project_id", "order_index")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_milestones_project_status_idx"
       ON "project_milestones" ("project_id", "status")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_tasks_project_status_idx"
       ON "project_tasks" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_tasks_milestone_order_idx"
       ON "project_tasks" ("milestone_id", "order_index")
       WHERE "milestone_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_tasks_assignee_status_idx"
       ON "project_tasks" ("assigned_freelancer_profile_id", "status")
       WHERE "assigned_freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_tasks_required_skills_gin_idx"
       ON "project_tasks" USING gin ("required_skills")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_task_dependencies_pair_uidx"
       ON "project_task_dependencies" ("task_id", "depends_on_task_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_payments_project_status_idx"
       ON "project_payments" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_payments_customer_status_idx"
       ON "project_payments" ("customer_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_payments_intent_uidx"
       ON "project_payments" ("stripe_payment_intent_id")
       WHERE "stripe_payment_intent_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_payments_checkout_session_uidx"
       ON "project_payments" ("stripe_checkout_session_id")
       WHERE "stripe_checkout_session_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "escrow_ledger_entries_project_created_idx"
       ON "escrow_ledger_entries" ("project_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "escrow_ledger_entries_payment_idx"
       ON "escrow_ledger_entries" ("payment_id")
       WHERE "payment_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "escrow_ledger_entries_freelancer_idx"
       ON "escrow_ledger_entries" ("freelancer_profile_id")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_event_uidx"
       ON "stripe_webhook_events" ("stripe_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "stripe_webhook_events_type_created_idx"
       ON "stripe_webhook_events" ("event_type", "created_at")`,
    );
  }

  private async createForeignKeys(queryRunner: QueryRunner): Promise<void> {
    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_runs_project_id_fk',
      `ALTER TABLE "matching_runs"
       ADD CONSTRAINT "matching_runs_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_runs_target_task_id_fk',
      `ALTER TABLE "matching_runs"
       ADD CONSTRAINT "matching_runs_target_task_id_fk"
       FOREIGN KEY ("target_task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_runs_requested_by_fk',
      `ALTER TABLE "matching_runs"
       ADD CONSTRAINT "matching_runs_requested_by_fk"
       FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_runs_reviewed_by_fk',
      `ALTER TABLE "matching_runs"
       ADD CONSTRAINT "matching_runs_reviewed_by_fk"
       FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_candidates_matching_run_id_fk',
      `ALTER TABLE "matching_candidates"
       ADD CONSTRAINT "matching_candidates_matching_run_id_fk"
       FOREIGN KEY ("matching_run_id") REFERENCES "matching_runs"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_candidates_freelancer_profile_id_fk',
      `ALTER TABLE "matching_candidates"
       ADD CONSTRAINT "matching_candidates_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'matching_candidates_selected_by_fk',
      `ALTER TABLE "matching_candidates"
       ADD CONSTRAINT "matching_candidates_selected_by_fk"
       FOREIGN KEY ("selected_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_role_assignments_project_id_fk',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_role_assignments_freelancer_profile_id_fk',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_role_assignments_source_matching_run_id_fk',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_source_matching_run_id_fk"
       FOREIGN KEY ("source_matching_run_id") REFERENCES "matching_runs"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_role_assignments_source_candidate_id_fk',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_source_candidate_id_fk"
       FOREIGN KEY ("source_candidate_id") REFERENCES "matching_candidates"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_role_assignments_assigned_by_fk',
      `ALTER TABLE "project_role_assignments"
       ADD CONSTRAINT "project_role_assignments_assigned_by_fk"
       FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_planning_submissions_project_id_fk',
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_planning_submissions_assignment_id_fk',
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_assignment_id_fk"
       FOREIGN KEY ("assignment_id") REFERENCES "project_role_assignments"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_planning_submissions_freelancer_profile_id_fk',
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_planning_submissions_reviewed_by_fk',
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_reviewed_by_fk"
       FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_plans_project_id_fk',
      `ALTER TABLE "project_plans"
       ADD CONSTRAINT "project_plans_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_plans_architecture_submission_id_fk',
      `ALTER TABLE "project_plans"
       ADD CONSTRAINT "project_plans_architecture_submission_id_fk"
       FOREIGN KEY ("architecture_submission_id") REFERENCES "project_planning_submissions"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_plans_uiux_submission_id_fk',
      `ALTER TABLE "project_plans"
       ADD CONSTRAINT "project_plans_uiux_submission_id_fk"
       FOREIGN KEY ("uiux_submission_id") REFERENCES "project_planning_submissions"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_plans_generated_by_job_id_fk',
      `ALTER TABLE "project_plans"
       ADD CONSTRAINT "project_plans_generated_by_job_id_fk"
       FOREIGN KEY ("generated_by_job_id") REFERENCES "agent_jobs"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_plans_approved_by_fk',
      `ALTER TABLE "project_plans"
       ADD CONSTRAINT "project_plans_approved_by_fk"
       FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_specs_project_id_fk',
      `ALTER TABLE "project_specs"
       ADD CONSTRAINT "project_specs_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_specs_approved_plan_id_fk',
      `ALTER TABLE "project_specs"
       ADD CONSTRAINT "project_specs_approved_plan_id_fk"
       FOREIGN KEY ("approved_plan_id") REFERENCES "project_plans"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_specs_approved_by_fk',
      `ALTER TABLE "project_specs"
       ADD CONSTRAINT "project_specs_approved_by_fk"
       FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_milestones_project_id_fk',
      `ALTER TABLE "project_milestones"
       ADD CONSTRAINT "project_milestones_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_milestones_project_plan_id_fk',
      `ALTER TABLE "project_milestones"
       ADD CONSTRAINT "project_milestones_project_plan_id_fk"
       FOREIGN KEY ("project_plan_id") REFERENCES "project_plans"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_tasks_project_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_tasks_project_plan_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_project_plan_id_fk"
       FOREIGN KEY ("project_plan_id") REFERENCES "project_plans"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_tasks_milestone_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_tasks_assignment_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_assignment_id_fk"
       FOREIGN KEY ("assignment_id") REFERENCES "project_role_assignments"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_tasks_assigned_freelancer_profile_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_assigned_freelancer_profile_id_fk"
       FOREIGN KEY ("assigned_freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_task_dependencies_task_id_fk',
      `ALTER TABLE "project_task_dependencies"
       ADD CONSTRAINT "project_task_dependencies_task_id_fk"
       FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_task_dependencies_depends_on_task_id_fk',
      `ALTER TABLE "project_task_dependencies"
       ADD CONSTRAINT "project_task_dependencies_depends_on_task_id_fk"
       FOREIGN KEY ("depends_on_task_id") REFERENCES "project_tasks"("id") ON DELETE CASCADE`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_payments_project_id_fk',
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_payments_milestone_id_fk',
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_payments_customer_id_fk',
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_customer_id_fk"
       FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_project_id_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_payment_id_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_payment_id_fk"
       FOREIGN KEY ("payment_id") REFERENCES "project_payments"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_milestone_id_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_freelancer_profile_id_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_created_by_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_created_by_fk"
       FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `UPDATE "agent_jobs" job
       SET "matching_run_id" = NULL
       WHERE job."matching_run_id" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "matching_runs" run WHERE run."id" = job."matching_run_id"
         )`,
    );
    await queryRunner.query(
      `UPDATE "agent_jobs" job
       SET "task_id" = NULL
       WHERE job."task_id" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "project_tasks" task WHERE task."id" = job."task_id"
         )`,
    );
    await queryRunner.query(
      `UPDATE "agent_jobs" job
       SET "submission_id" = NULL
       WHERE job."submission_id" IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM "project_planning_submissions" submission
           WHERE submission."id" = job."submission_id"
         )`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_matching_run_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_matching_run_id_fk"
       FOREIGN KEY ("matching_run_id") REFERENCES "matching_runs"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_task_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_task_id_fk"
       FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_submission_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_submission_id_fk"
       FOREIGN KEY ("submission_id") REFERENCES "project_planning_submissions"("id") ON DELETE SET NULL`,
    );
  }

  private async addConstraintIfMissing(
    queryRunner: QueryRunner,
    constraintName: string,
    query: string,
  ): Promise<void> {
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = '${constraintName}'
         ) THEN
           ${query};
         END IF;
       END $$`,
    );
  }

  private async addForeignKeyIfMissing(
    queryRunner: QueryRunner,
    constraintName: string,
    query: string,
  ): Promise<void> {
    await this.addConstraintIfMissing(queryRunner, constraintName, query);
  }
}
