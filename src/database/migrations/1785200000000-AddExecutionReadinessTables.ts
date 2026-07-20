import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionReadinessTables1785200000000 implements MigrationInterface {
  name = 'AddExecutionReadinessTables1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       ADD COLUMN IF NOT EXISTS "project_submission_id" uuid`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_repositories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL DEFAULT 'github',
        "owner" varchar(120) NOT NULL,
        "repo_name" varchar(160) NOT NULL,
        "repo_url" varchar(500) NOT NULL,
        "external_id" varchar(120),
        "installation_id" varchar(120),
        "default_branch" varchar(120) NOT NULL DEFAULT 'main',
        "status" varchar(40) NOT NULL DEFAULT 'pending',
        "created_by" uuid,
        "last_synced_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_repositories_provider_check',
      `ALTER TABLE "project_repositories"
       ADD CONSTRAINT "project_repositories_provider_check"
       CHECK ("provider" IN ('github', 'gitlab', 'bitbucket', 'external'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_repositories_status_check',
      `ALTER TABLE "project_repositories"
       ADD CONSTRAINT "project_repositories_status_check"
       CHECK (
         "status" IN (
           'pending',
           'creating',
           'active',
           'failed',
           'archived'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "repository_collaborators" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "repository_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "freelancer_profile_id" uuid,
        "assignment_id" uuid,
        "github_username" varchar(120),
        "github_user_id" varchar(120),
        "permission" varchar(40) NOT NULL DEFAULT 'push',
        "invite_status" varchar(40) NOT NULL DEFAULT 'pending',
        "invite_url" varchar(500),
        "invited_at" timestamptz,
        "accepted_at" timestamptz,
        "removed_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'repository_collaborators_permission_check',
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_permission_check"
       CHECK ("permission" IN ('pull', 'triage', 'push', 'maintain', 'admin'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'repository_collaborators_invite_status_check',
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_invite_status_check"
       CHECK (
         "invite_status" IN (
           'pending',
           'invited',
           'accepted',
           'declined',
           'removed',
           'failed'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_submissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "milestone_id" uuid,
        "task_id" uuid,
        "assignment_id" uuid,
        "freelancer_profile_id" uuid,
        "repository_id" uuid,
        "version" int NOT NULL DEFAULT 1,
        "status" varchar(40) NOT NULL DEFAULT 'draft',
        "title" varchar(255),
        "summary" text,
        "content" jsonb,
        "file_urls" jsonb,
        "repo_url" varchar(500),
        "branch_name" varchar(255),
        "pull_request_url" varchar(500),
        "commit_sha" varchar(80),
        "metadata" jsonb,
        "submitted_at" timestamptz,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "approved_at" timestamptz,
        "rejected_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("version" > 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_submissions_status_check',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_status_check"
       CHECK (
         "status" IN (
           'draft',
           'submitted',
           'under_review',
           'changes_requested',
           'approved',
           'rejected',
           'superseded'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_submission_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "submission_id" uuid NOT NULL,
        "milestone_id" uuid,
        "task_id" uuid,
        "reviewer_user_id" uuid,
        "reviewer_role" varchar(40) NOT NULL,
        "decision" varchar(40) NOT NULL,
        "feedback" text,
        "requested_changes" jsonb,
        "score" numeric(5,2),
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_submission_reviews_reviewer_role_check',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_reviewer_role_check"
       CHECK ("reviewer_role" IN ('admin', 'customer', 'ai', 'system'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_submission_reviews_decision_check',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_decision_check"
       CHECK (
         "decision" IN (
           'commented',
           'approved',
           'changes_requested',
           'rejected',
           'score_adjusted'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "project_revision_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "milestone_id" uuid,
        "task_id" uuid,
        "submission_id" uuid,
        "requested_by" uuid,
        "assigned_to_freelancer_profile_id" uuid,
        "status" varchar(40) NOT NULL DEFAULT 'open',
        "priority" varchar(40) NOT NULL DEFAULT 'medium',
        "title" varchar(255) NOT NULL,
        "description" text,
        "requested_changes" jsonb,
        "metadata" jsonb,
        "due_at" timestamptz,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_revision_requests_status_check',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_status_check"
       CHECK ("status" IN ('open', 'in_progress', 'resolved', 'cancelled'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_revision_requests_priority_check',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_priority_check"
       CHECK ("priority" IN ('low', 'medium', 'high', 'urgent'))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "evaluation_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "milestone_id" uuid,
        "task_id" uuid,
        "submission_id" uuid,
        "agent_job_id" uuid,
        "status" varchar(40) NOT NULL DEFAULT 'queued',
        "score" numeric(5,2),
        "recommendation" varchar(40),
        "summary" text,
        "findings" jsonb,
        "acceptance_coverage" jsonb,
        "risk_flags" text[],
        "model_name" varchar(120),
        "prompt_version" varchar(80),
        "error" text,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'evaluation_runs_status_check',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_status_check"
       CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'cancelled'))`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'evaluation_runs_recommendation_check',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_recommendation_check"
       CHECK (
         "recommendation" IS NULL OR
         "recommendation" IN (
           'approve',
           'changes_requested',
           'reject',
           'manual_review'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payment_release_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "milestone_id" uuid,
        "submission_id" uuid,
        "payment_id" uuid,
        "freelancer_profile_id" uuid,
        "amount" numeric(12,2) NOT NULL,
        "currency" char(3) NOT NULL DEFAULT 'EGP',
        "status" varchar(40) NOT NULL DEFAULT 'pending',
        "reason" text,
        "review_notes" text,
        "requested_by" uuid,
        "reviewed_by" uuid,
        "approved_at" timestamptz,
        "rejected_at" timestamptz,
        "released_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("amount" >= 0)
      )`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'payment_release_requests_status_check',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_status_check"
       CHECK (
         "status" IN (
           'pending',
           'approved',
           'rejected',
           'released',
           'cancelled',
           'failed'
         )
       )`,
    );

    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       ADD COLUMN IF NOT EXISTS "approved_submission_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       ADD COLUMN IF NOT EXISTS "release_request_id" uuid`,
    );

    await this.createIndexes(queryRunner);
    await this.createForeignKeys(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_project_submission_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP CONSTRAINT IF EXISTS "escrow_ledger_entries_release_request_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP CONSTRAINT IF EXISTS "escrow_ledger_entries_approved_submission_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP COLUMN IF EXISTS "release_request_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP COLUMN IF EXISTS "approved_submission_id"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "payment_release_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "evaluation_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_revision_requests"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "project_submission_reviews"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "project_submissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "repository_collaborators"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_repositories"`);

    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP COLUMN IF EXISTS "project_submission_id"`,
    );
  }

  private async createIndexes(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_repositories_project_status_idx"
       ON "project_repositories" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_repositories_provider_owner_repo_uidx"
       ON "project_repositories" ("provider", "owner", "repo_name")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "repository_collaborators_repo_status_idx"
       ON "repository_collaborators" ("repository_id", "invite_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "repository_collaborators_project_freelancer_idx"
       ON "repository_collaborators" ("project_id", "freelancer_profile_id")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "repository_collaborators_repo_freelancer_uidx"
       ON "repository_collaborators" ("repository_id", "freelancer_profile_id")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "repository_collaborators_repo_github_username_uidx"
       ON "repository_collaborators" ("repository_id", "github_username")
       WHERE "github_username" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submissions_project_status_idx"
       ON "project_submissions" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submissions_task_status_idx"
       ON "project_submissions" ("task_id", "status")
       WHERE "task_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submissions_freelancer_status_idx"
       ON "project_submissions" ("freelancer_profile_id", "status")
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_submissions_task_freelancer_version_uidx"
       ON "project_submissions" ("task_id", "freelancer_profile_id", "version")
       WHERE "task_id" IS NOT NULL AND "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_submissions_milestone_freelancer_version_uidx"
       ON "project_submissions" ("milestone_id", "freelancer_profile_id", "version")
       WHERE "milestone_id" IS NOT NULL AND "freelancer_profile_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submission_reviews_submission_created_idx"
       ON "project_submission_reviews" ("submission_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submission_reviews_project_decision_idx"
       ON "project_submission_reviews" ("project_id", "decision")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submission_reviews_reviewer_created_idx"
       ON "project_submission_reviews" ("reviewer_user_id", "created_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_revision_requests_project_status_idx"
       ON "project_revision_requests" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_revision_requests_task_status_idx"
       ON "project_revision_requests" ("task_id", "status")
       WHERE "task_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_revision_requests_assignee_status_idx"
       ON "project_revision_requests" ("assigned_to_freelancer_profile_id", "status")
       WHERE "assigned_to_freelancer_profile_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "evaluation_runs_project_status_idx"
       ON "evaluation_runs" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "evaluation_runs_submission_status_idx"
       ON "evaluation_runs" ("submission_id", "status")
       WHERE "submission_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "evaluation_runs_task_status_idx"
       ON "evaluation_runs" ("task_id", "status")
       WHERE "task_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "evaluation_runs_risk_flags_gin_idx"
       ON "evaluation_runs" USING gin ("risk_flags")
       WHERE "risk_flags" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "payment_release_requests_project_status_idx"
       ON "payment_release_requests" ("project_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "payment_release_requests_milestone_status_idx"
       ON "payment_release_requests" ("milestone_id", "status")
       WHERE "milestone_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "payment_release_requests_submission_status_idx"
       ON "payment_release_requests" ("submission_id", "status")
       WHERE "submission_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "payment_release_requests_pending_milestone_uidx"
       ON "payment_release_requests" ("milestone_id", "freelancer_profile_id")
       WHERE "milestone_id" IS NOT NULL
         AND "freelancer_profile_id" IS NOT NULL
         AND "status" IN ('pending', 'approved')`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "escrow_ledger_entries_release_request_idx"
       ON "escrow_ledger_entries" ("release_request_id")
       WHERE "release_request_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "escrow_ledger_entries_approved_submission_idx"
       ON "escrow_ledger_entries" ("approved_submission_id")
       WHERE "approved_submission_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_project_submission_idx"
       ON "agent_jobs" ("project_submission_id")
       WHERE "project_submission_id" IS NOT NULL`,
    );
  }

  private async createForeignKeys(queryRunner: QueryRunner): Promise<void> {
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_repositories_project_id_fk',
      `ALTER TABLE "project_repositories"
       ADD CONSTRAINT "project_repositories_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_repositories_created_by_fk',
      `ALTER TABLE "project_repositories"
       ADD CONSTRAINT "project_repositories_created_by_fk"
       FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'repository_collaborators_repository_id_fk',
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_repository_id_fk"
       FOREIGN KEY ("repository_id") REFERENCES "project_repositories"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'repository_collaborators_project_id_fk',
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'repository_collaborators_freelancer_profile_id_fk',
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'repository_collaborators_assignment_id_fk',
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_assignment_id_fk"
       FOREIGN KEY ("assignment_id") REFERENCES "project_role_assignments"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_project_id_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_milestone_id_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_task_id_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_task_id_fk"
       FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_assignment_id_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_assignment_id_fk"
       FOREIGN KEY ("assignment_id") REFERENCES "project_role_assignments"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_freelancer_profile_id_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_repository_id_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_repository_id_fk"
       FOREIGN KEY ("repository_id") REFERENCES "project_repositories"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submissions_reviewed_by_fk',
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_reviewed_by_fk"
       FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submission_reviews_project_id_fk',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submission_reviews_submission_id_fk',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_submission_id_fk"
       FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submission_reviews_milestone_id_fk',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submission_reviews_task_id_fk',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_task_id_fk"
       FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_submission_reviews_reviewer_user_id_fk',
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_reviewer_user_id_fk"
       FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_revision_requests_project_id_fk',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_revision_requests_milestone_id_fk',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_revision_requests_task_id_fk',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_task_id_fk"
       FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_revision_requests_submission_id_fk',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_submission_id_fk"
       FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_revision_requests_requested_by_fk',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_requested_by_fk"
       FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_revision_requests_assigned_to_freelancer_profile_id_fk',
      `ALTER TABLE "project_revision_requests"
       ADD CONSTRAINT "project_revision_requests_assigned_to_freelancer_profile_id_fk"
       FOREIGN KEY ("assigned_to_freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'evaluation_runs_project_id_fk',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'evaluation_runs_milestone_id_fk',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'evaluation_runs_task_id_fk',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_task_id_fk"
       FOREIGN KEY ("task_id") REFERENCES "project_tasks"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'evaluation_runs_submission_id_fk',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_submission_id_fk"
       FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'evaluation_runs_agent_job_id_fk',
      `ALTER TABLE "evaluation_runs"
       ADD CONSTRAINT "evaluation_runs_agent_job_id_fk"
       FOREIGN KEY ("agent_job_id") REFERENCES "agent_jobs"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_project_id_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_milestone_id_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_milestone_id_fk"
       FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_submission_id_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_submission_id_fk"
       FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_payment_id_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_payment_id_fk"
       FOREIGN KEY ("payment_id") REFERENCES "project_payments"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_freelancer_profile_id_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_requested_by_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_requested_by_fk"
       FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'payment_release_requests_reviewed_by_fk',
      `ALTER TABLE "payment_release_requests"
       ADD CONSTRAINT "payment_release_requests_reviewed_by_fk"
       FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_approved_submission_id_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_approved_submission_id_fk"
       FOREIGN KEY ("approved_submission_id") REFERENCES "project_submissions"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'escrow_ledger_entries_release_request_id_fk',
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_release_request_id_fk"
       FOREIGN KEY ("release_request_id") REFERENCES "payment_release_requests"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_project_submission_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_project_submission_id_fk"
       FOREIGN KEY ("project_submission_id") REFERENCES "project_submissions"("id") ON DELETE SET NULL`,
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
