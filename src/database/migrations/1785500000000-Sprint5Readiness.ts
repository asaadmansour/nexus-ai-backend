import { MigrationInterface, QueryRunner } from 'typeorm';

export class Sprint5Readiness1785500000000 implements MigrationInterface {
  name = 'Sprint5Readiness1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "github_username" varchar(120)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_profiles_github_username_idx"
       ON "freelancer_profiles" ("github_username")
       WHERE "github_username" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       ADD COLUMN IF NOT EXISTS "source_matching_run_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       ADD COLUMN IF NOT EXISTS "source_candidate_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       ADD COLUMN IF NOT EXISTS "assigned_by" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       ADD COLUMN IF NOT EXISTS "assigned_at" timestamptz`,
    );

    await this.addConstraintIfMissing(
      queryRunner,
      'project_tasks_source_matching_run_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_source_matching_run_id_fk"
       FOREIGN KEY ("source_matching_run_id") REFERENCES "matching_runs"("id") ON DELETE SET NULL`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_tasks_source_candidate_id_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_source_candidate_id_fk"
       FOREIGN KEY ("source_candidate_id") REFERENCES "matching_candidates"("id") ON DELETE SET NULL`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'project_tasks_assigned_by_fk',
      `ALTER TABLE "project_tasks"
       ADD CONSTRAINT "project_tasks_assigned_by_fk"
       FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_tasks_source_matching_run_idx"
       ON "project_tasks" ("source_matching_run_id")
       WHERE "source_matching_run_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_tasks_assigned_at_idx"
       ON "project_tasks" ("project_id", "assigned_at")
       WHERE "assigned_at" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       DROP CONSTRAINT IF EXISTS "repository_collaborators_invite_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_invite_status_check"
       CHECK (
         "invite_status" IN (
           'pending',
           'missing_username',
           'invited',
           'accepted',
           'declined',
           'removed',
           'failed'
         )
       )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_repositories_project_non_archived_uidx"
       ON "project_repositories" ("project_id")
       WHERE "status" <> 'archived'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "payment_release_requests_pending_submission_uidx"
       ON "payment_release_requests" ("submission_id", "freelancer_profile_id")
       WHERE "submission_id" IS NOT NULL
         AND "freelancer_profile_id" IS NOT NULL
         AND "status" IN ('pending', 'approved')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "evaluation_runs_submission_active_uidx"
       ON "evaluation_runs" ("submission_id")
       WHERE "submission_id" IS NOT NULL
         AND "status" IN ('queued', 'running', 'completed')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "evaluation_runs_submission_active_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "payment_release_requests_pending_submission_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_repositories_project_non_archived_uidx"`,
    );

    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       DROP CONSTRAINT IF EXISTS "repository_collaborators_invite_status_check"`,
    );
    await queryRunner.query(
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
      `DROP INDEX IF EXISTS "project_tasks_assigned_at_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_tasks_source_matching_run_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       DROP CONSTRAINT IF EXISTS "project_tasks_assigned_by_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       DROP CONSTRAINT IF EXISTS "project_tasks_source_candidate_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
       DROP CONSTRAINT IF EXISTS "project_tasks_source_matching_run_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "assigned_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "assigned_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "source_candidate_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks" DROP COLUMN IF EXISTS "source_matching_run_id"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_github_username_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles" DROP COLUMN IF EXISTS "github_username"`,
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
}
