import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrepareQueuedAssessmentGeneration1784800000000 implements MigrationInterface {
  name = 'PrepareQueuedAssessmentGeneration1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       ADD COLUMN IF NOT EXISTS "user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       ADD COLUMN IF NOT EXISTS "freelancer_profile_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       ADD COLUMN IF NOT EXISTS "assessment_id" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_generation_status" varchar(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_generation_queued_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_generation_started_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_generated_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_generation_error" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_generation_job_id" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD COLUMN IF NOT EXISTS "generation_job_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD COLUMN IF NOT EXISTS "generated_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD COLUMN IF NOT EXISTS "generation_input" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD COLUMN IF NOT EXISTS "generation_error" text`,
    );

    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_user_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_user_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_freelancer_profile_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_freelancer_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id")
       REFERENCES "freelancer_profiles"("id")
       ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs_assessment_id_fk',
      `ALTER TABLE "agent_jobs"
       ADD CONSTRAINT "agent_jobs_assessment_id_fk"
       FOREIGN KEY ("assessment_id")
       REFERENCES "freelancer_assessments"("id")
       ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_profiles_assessment_generation_job_id_fk',
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_assessment_generation_job_id_fk"
       FOREIGN KEY ("assessment_generation_job_id")
       REFERENCES "agent_jobs"("id")
       ON DELETE SET NULL`,
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessments_generation_job_id_fk',
      `ALTER TABLE "freelancer_assessments"
       ADD CONSTRAINT "freelancer_assessments_generation_job_id_fk"
       FOREIGN KEY ("generation_job_id")
       REFERENCES "agent_jobs"("id")
       ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_cv_extraction_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_cv_extraction_status_check"
       CHECK (
         "cv_extraction_status" IS NULL
         OR "cv_extraction_status" IN (
           'pending',
           'queued',
           'processing',
           'completed',
           'failed'
         )
       )`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_assessment_generation_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_assessment_generation_status_check"
       CHECK (
         "assessment_generation_status" IS NULL
         OR "assessment_generation_status" IN (
           'pending',
           'queued',
           'processing',
           'ready',
           'failed'
         )
       )`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP CONSTRAINT IF EXISTS "freelancer_assessments_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD CONSTRAINT "freelancer_assessments_status_check"
       CHECK (
         "status" IN (
           'pending',
           'generating',
           'ready',
           'in_progress',
           'submitted',
           'graded',
           'needs_review',
           'passed',
           'failed',
           'expired',
           'cancelled',
           'generation_failed'
         )
       )`,
    );

    await queryRunner.query(
      `UPDATE "freelancer_assessments" assessment
       SET "generated_at" = COALESCE(
         (
           SELECT MIN(question."created_at")
           FROM "freelancer_assessment_questions" question
           WHERE question."assessment_id" = assessment."id"
         ),
         assessment."created_at"
       )
       WHERE assessment."generated_at" IS NULL
         AND EXISTS (
           SELECT 1
           FROM "freelancer_assessment_questions" question
           WHERE question."assessment_id" = assessment."id"
         )`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_assessments"
       SET "generation_input" = jsonb_strip_nulls(
         jsonb_build_object('cvUrl', "generated_from_cv_url")
       )
       WHERE "generation_input" IS NULL
         AND "generated_from_cv_url" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_profiles" profile
       SET "assessment_generation_status" = 'ready',
           "assessment_generated_at" = COALESCE(
             (
               SELECT MAX(assessment."generated_at")
               FROM "freelancer_assessments" assessment
               WHERE assessment."freelancer_profile_id" = profile."id"
                 AND EXISTS (
                   SELECT 1
                   FROM "freelancer_assessment_questions" question
                   WHERE question."assessment_id" = assessment."id"
                 )
             ),
             profile."updated_at"
           )
       WHERE profile."assessment_generation_status" IS NULL
         AND EXISTS (
           SELECT 1
           FROM "freelancer_assessments" assessment
           JOIN "freelancer_assessment_questions" question
             ON question."assessment_id" = assessment."id"
           WHERE assessment."freelancer_profile_id" = profile."id"
         )`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_profiles"
       SET "assessment_generation_status" = 'pending'
       WHERE "assessment_generation_status" IS NULL
         AND "cv_extraction_status" = 'completed'
         AND COALESCE(array_length("skills", 1), 0) > 0`,
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT
           "id",
           ROW_NUMBER() OVER (
             PARTITION BY "user_id"
             ORDER BY "created_at" DESC, "id" DESC
           ) AS row_number
         FROM "freelancer_assessments"
         WHERE "status" IN ('pending', 'generating', 'ready', 'in_progress')
       )
       UPDATE "freelancer_assessments" assessment
       SET "status" = CASE
             WHEN assessment."started_at" IS NULL THEN 'cancelled'
             ELSE 'expired'
           END,
           "ai_feedback" = COALESCE(assessment."ai_feedback", '{}'::jsonb)
             || jsonb_build_object(
               'systemReason',
               'superseded_by_newer_open_assessment'
             )
       FROM ranked
       WHERE assessment."id" = ranked."id"
         AND ranked.row_number > 1`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_user_created_idx"
       ON "agent_jobs" ("user_id", "created_at" DESC)
       WHERE "user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_freelancer_profile_created_idx"
       ON "agent_jobs" ("freelancer_profile_id", "created_at" DESC)
       WHERE "freelancer_profile_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_assessment_created_idx"
       ON "agent_jobs" ("assessment_id", "created_at" DESC)
       WHERE "assessment_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_profiles_assessment_generation_status_idx"
       ON "freelancer_profiles" ("assessment_generation_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_profiles_assessment_generation_job_idx"
       ON "freelancer_profiles" ("assessment_generation_job_id")
       WHERE "assessment_generation_job_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_generation_job_idx"
       ON "freelancer_assessments" ("generation_job_id")
       WHERE "generation_job_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_open_status_idx"
       ON "freelancer_assessments" ("user_id", "status", "created_at" DESC)
       WHERE "status" IN ('pending', 'generating', 'ready', 'in_progress')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "freelancer_assessments_one_open_per_user_uidx"
       ON "freelancer_assessments" ("user_id")
       WHERE "status" IN ('pending', 'generating', 'ready', 'in_progress')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_one_open_per_user_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_open_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_generation_job_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_assessment_generation_job_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_assessment_generation_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_assessment_created_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_freelancer_profile_created_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_user_created_idx"`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP CONSTRAINT IF EXISTS "freelancer_assessments_status_check"`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_profiles"
       SET "cv_extraction_status" = 'processing'
       WHERE "cv_extraction_status" = 'queued'`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_assessment_generation_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_cv_extraction_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_cv_extraction_status_check"
       CHECK (
         "cv_extraction_status" IS NULL
         OR "cv_extraction_status" IN (
           'pending',
           'processing',
           'completed',
           'failed'
         )
       )`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP CONSTRAINT IF EXISTS "freelancer_assessments_generation_job_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_assessment_generation_job_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_assessment_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_freelancer_profile_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP CONSTRAINT IF EXISTS "agent_jobs_user_id_fk"`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP COLUMN IF EXISTS "generation_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP COLUMN IF EXISTS "generation_input"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP COLUMN IF EXISTS "generated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP COLUMN IF EXISTS "generation_job_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_generation_job_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_generation_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_generated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_generation_started_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_generation_queued_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_generation_status"`,
    );

    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP COLUMN IF EXISTS "assessment_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP COLUMN IF EXISTS "freelancer_profile_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs"
       DROP COLUMN IF EXISTS "user_id"`,
    );
  }

  private async addForeignKeyIfMissing(
    queryRunner: QueryRunner,
    constraintName: string,
    query: string,
  ) {
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
