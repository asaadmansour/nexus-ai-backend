import { MigrationInterface, QueryRunner } from 'typeorm';

export class FinalDeliveryWorkflow1786500000000 implements MigrationInterface {
  name = 'FinalDeliveryWorkflow1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project_handoffs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" uuid NOT NULL,
        "repository_id" uuid,
        "status" varchar(50) NOT NULL DEFAULT 'integrating',
        "integration_branch" varchar(255) NOT NULL,
        "integration_commit_sha" varchar(40),
        "summary" text,
        "live_url" text,
        "artifact_urls" jsonb,
        "verification_report" jsonb,
        "audit_bundle" jsonb,
        "last_error" text,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "reviewed_by" uuid,
        "reviewer_feedback" text,
        "reviewer_approved_at" timestamptz,
        "client_review_due_at" timestamptz,
        "client_feedback" text,
        "client_accepted_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "project_handoffs_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "project_handoffs_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "project_handoffs_repository_fk" FOREIGN KEY ("repository_id") REFERENCES "project_repositories"("id") ON DELETE SET NULL,
        CONSTRAINT "project_handoffs_reviewer_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "project_handoffs_status_ck" CHECK ("status" IN ('integrating', 'verifying', 'integration_failed', 'verification_failed', 'reviewer_review', 'changes_requested', 'client_review', 'client_changes_requested', 'accepted'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_handoffs_project_uidx" ON "project_handoffs" ("project_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "project_handoffs_status_retry_idx" ON "project_handoffs" ("status", "next_attempt_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "project_ratings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" uuid NOT NULL,
        "rater_user_id" uuid NOT NULL,
        "rated_user_id" uuid NOT NULL,
        "freelancer_profile_id" uuid NOT NULL,
        "role_keys" text[] NOT NULL DEFAULT '{}',
        "rating" smallint NOT NULL,
        "category_ratings" jsonb,
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "project_ratings_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "project_ratings_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "project_ratings_rater_fk" FOREIGN KEY ("rater_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "project_ratings_recipient_fk" FOREIGN KEY ("rated_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "project_ratings_profile_fk" FOREIGN KEY ("freelancer_profile_id") REFERENCES "freelancer_profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "project_ratings_rating_ck" CHECK ("rating" BETWEEN 1 AND 5),
        CONSTRAINT "project_ratings_not_self_ck" CHECK ("rater_user_id" <> "rated_user_id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_ratings_project_rater_recipient_uidx" ON "project_ratings" ("project_id", "rater_user_id", "rated_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "project_ratings_profile_idx" ON "project_ratings" ("freelancer_profile_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "project_ratings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_handoffs"`);
  }
}
