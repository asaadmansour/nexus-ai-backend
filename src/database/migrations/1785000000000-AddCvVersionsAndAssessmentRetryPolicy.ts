import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCvVersionsAndAssessmentRetryPolicy1785000000000 implements MigrationInterface {
  name = 'AddCvVersionsAndAssessmentRetryPolicy1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "freelancer_cv_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "freelancer_profile_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "version_number" int NOT NULL,
        "cv_url" text NOT NULL,
        "cloudinary_public_id" text,
        "file_sha256" char(64) NOT NULL,
        "original_filename" varchar(255),
        "file_size" int,
        "mime_type" varchar(120),
        "status" varchar(40) NOT NULL DEFAULT 'processing',
        "extracted_skills" text[],
        "new_skills" text[],
        "retained_skills" text[],
        "removed_skills" text[],
        "extraction_error" text,
        "extracted_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CHECK ("version_number" > 0),
        CHECK ("file_size" IS NULL OR "file_size" > 0),
        CHECK (
          "status" IN (
            'processing',
            'active',
            'superseded',
            'extraction_failed',
            'cancelled'
          )
        )
      )`,
    );

    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_cv_versions_profile_id_fk',
      `ALTER TABLE "freelancer_cv_versions"
       ADD CONSTRAINT "freelancer_cv_versions_profile_id_fk"
       FOREIGN KEY ("freelancer_profile_id")
       REFERENCES "freelancer_profiles"("id") ON DELETE CASCADE`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_cv_versions_user_id_fk',
      `ALTER TABLE "freelancer_cv_versions"
       ADD CONSTRAINT "freelancer_cv_versions_user_id_fk"
       FOREIGN KEY ("user_id")
       REFERENCES "users"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "freelancer_cv_versions_profile_version_uidx"
       ON "freelancer_cv_versions" ("freelancer_profile_id", "version_number")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "freelancer_cv_versions_profile_hash_uidx"
       ON "freelancer_cv_versions" ("freelancer_profile_id", "file_sha256")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_cv_versions_profile_created_idx"
       ON "freelancer_cv_versions" ("freelancer_profile_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_cv_versions_status_idx"
       ON "freelancer_cv_versions" ("status")`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "current_cv_version_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "cv_upload_cooldown_until" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_attempts_used" int NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "assessment_retry_available_at" timestamptz`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_profiles_current_cv_version_fk',
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_current_cv_version_fk"
       FOREIGN KEY ("current_cv_version_id")
       REFERENCES "freelancer_cv_versions"("id") ON DELETE SET NULL`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_profiles_assessment_attempts_used_check',
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_assessment_attempts_used_check"
       CHECK ("assessment_attempts_used" >= 0)`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD COLUMN IF NOT EXISTS "cv_version_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       ADD COLUMN IF NOT EXISTS "attempt_number" int NOT NULL DEFAULT 1`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_assessments_cv_version_fk',
      `ALTER TABLE "freelancer_assessments"
       ADD CONSTRAINT "freelancer_assessments_cv_version_fk"
       FOREIGN KEY ("cv_version_id")
       REFERENCES "freelancer_cv_versions"("id") ON DELETE SET NULL`,
    );
    await this.addConstraintIfMissing(
      queryRunner,
      'freelancer_assessments_attempt_number_check',
      `ALTER TABLE "freelancer_assessments"
       ADD CONSTRAINT "freelancer_assessments_attempt_number_check"
       CHECK ("attempt_number" > 0)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_user_attempt_idx"
       ON "freelancer_assessments" ("user_id", "attempt_number" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_cv_version_idx"
       ON "freelancer_assessments" ("cv_version_id")
       WHERE "cv_version_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `INSERT INTO "freelancer_cv_versions" (
         "freelancer_profile_id",
         "user_id",
         "version_number",
         "cv_url",
         "cloudinary_public_id",
         "file_sha256",
         "original_filename",
         "file_size",
         "mime_type",
         "status",
         "extracted_skills",
         "extracted_at",
         "metadata",
         "created_at",
         "updated_at"
       )
       SELECT
         profile."id",
         profile."user_id",
         1,
         profile."cv_url",
         NULL,
         encode(digest(profile."cv_url", 'sha256'), 'hex'),
         NULL,
         NULL,
         'application/pdf',
         CASE
           WHEN profile."cv_extraction_status" = 'completed' THEN 'active'
           WHEN profile."cv_extraction_status" = 'failed' THEN 'extraction_failed'
           ELSE 'processing'
         END,
         profile."skills",
         profile."cv_extracted_at",
         jsonb_build_object('source', 'migration_from_freelancer_profiles_cv_url'),
         COALESCE(profile."cv_extracted_at", profile."created_at", now()),
         COALESCE(profile."updated_at", now())
       FROM "freelancer_profiles" profile
       WHERE profile."cv_url" IS NOT NULL
       ON CONFLICT ("freelancer_profile_id", "file_sha256") DO NOTHING`,
    );

    await queryRunner.query(
      `UPDATE "freelancer_profiles" profile
       SET "current_cv_version_id" = version."id",
           "cv_upload_cooldown_until" = COALESCE(
             profile."cv_upload_cooldown_until",
             version."created_at" + interval '7 days'
           )
       FROM "freelancer_cv_versions" version
       WHERE version."freelancer_profile_id" = profile."id"
         AND version."version_number" = 1
         AND profile."current_cv_version_id" IS NULL`,
    );

    await queryRunner.query(
      `WITH ordered AS (
         SELECT
           assessment."id",
           row_number() OVER (
             PARTITION BY assessment."user_id"
             ORDER BY assessment."created_at" ASC, assessment."id" ASC
           ) AS attempt_number,
           version."id" AS cv_version_id
         FROM "freelancer_assessments" assessment
         LEFT JOIN "freelancer_cv_versions" version
           ON version."freelancer_profile_id" = assessment."freelancer_profile_id"
          AND version."cv_url" = assessment."generated_from_cv_url"
       )
       UPDATE "freelancer_assessments" assessment
       SET "attempt_number" = ordered."attempt_number",
           "cv_version_id" = ordered."cv_version_id"
       FROM ordered
       WHERE assessment."id" = ordered."id"`,
    );

    await queryRunner.query(
      `WITH attempts AS (
         SELECT
           "freelancer_profile_id",
           count(*)::int AS attempts_used,
           max(COALESCE("submitted_at", "updated_at")) FILTER (
             WHERE "status" IN ('failed', 'expired')
           ) AS last_failed_at
         FROM "freelancer_assessments"
         WHERE "status" IN (
           'in_progress',
           'submitted',
           'needs_review',
           'passed',
           'failed',
           'expired'
         )
         GROUP BY "freelancer_profile_id"
       )
       UPDATE "freelancer_profiles" profile
       SET "assessment_attempts_used" = attempts."attempts_used",
           "assessment_retry_available_at" = CASE
             WHEN attempts."last_failed_at" IS NOT NULL
             THEN attempts."last_failed_at" + interval '30 days'
             ELSE profile."assessment_retry_available_at"
           END
       FROM attempts
       WHERE attempts."freelancer_profile_id" = profile."id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_cv_version_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_user_attempt_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP CONSTRAINT IF EXISTS "freelancer_assessments_attempt_number_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP CONSTRAINT IF EXISTS "freelancer_assessments_cv_version_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP COLUMN IF EXISTS "attempt_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments"
       DROP COLUMN IF EXISTS "cv_version_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_assessment_attempts_used_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_current_cv_version_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_retry_available_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "assessment_attempts_used"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "cv_upload_cooldown_until"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "current_cv_version_id"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_cv_versions_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_cv_versions_profile_created_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_cv_versions_profile_hash_uidx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_cv_versions_profile_version_uidx"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "freelancer_cv_versions"`);
  }

  private async addConstraintIfMissing(
    queryRunner: QueryRunner,
    name: string,
    sql: string,
  ) {
    const exists = (await queryRunner.query(
      `SELECT 1
       FROM pg_constraint
       WHERE conname = $1`,
      [name],
    )) as unknown;
    const rows = Array.isArray(exists) ? exists : [];
    if (!rows.length) {
      await queryRunner.query(sql);
    }
  }
}
