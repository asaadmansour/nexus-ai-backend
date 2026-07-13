import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVerificationEventsAndCvExtractionStatus1784500000000 implements MigrationInterface {
  name = 'AddVerificationEventsAndCvExtractionStatus1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "cv_extraction_status" varchar(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "cv_extracted_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "cv_extraction_error" text`,
    );
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'freelancer_profiles_cv_extraction_status_check'
         ) THEN
           ALTER TABLE "freelancer_profiles"
           ADD CONSTRAINT "freelancer_profiles_cv_extraction_status_check"
           CHECK (
             "cv_extraction_status" IS NULL
             OR "cv_extraction_status" IN ('pending', 'processing', 'completed', 'failed')
           );
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_profiles"
       SET "cv_extraction_status" = 'completed',
           "cv_extracted_at" = COALESCE("cv_extracted_at", "updated_at")
       WHERE "cv_url" IS NOT NULL
         AND COALESCE(array_length("skills", 1), 0) > 0
         AND "cv_extraction_status" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_profiles"
       SET "cv_extraction_status" = 'pending'
       WHERE "cv_url" IS NOT NULL
         AND "cv_extraction_status" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_profiles_cv_extraction_status_idx"
       ON "freelancer_profiles" ("cv_extraction_status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "freelancer_verification_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "freelancer_profile_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "event_type" varchar(80) NOT NULL,
        "from_status" varchar(40),
        "to_status" varchar(40),
        "actor_type" varchar(30) NOT NULL DEFAULT 'system',
        "actor_user_id" uuid,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "freelancer_verification_events_profile_fk"
          FOREIGN KEY ("freelancer_profile_id")
          REFERENCES "freelancer_profiles"("id")
          ON DELETE CASCADE,
        CONSTRAINT "freelancer_verification_events_user_fk"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "freelancer_verification_events_actor_user_fk"
          FOREIGN KEY ("actor_user_id")
          REFERENCES "users"("id")
          ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_verification_events_profile_created_idx"
       ON "freelancer_verification_events" ("freelancer_profile_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_verification_events_user_created_idx"
       ON "freelancer_verification_events" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_verification_events_type_created_idx"
       ON "freelancer_verification_events" ("event_type", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "freelancer_verification_events"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."freelancer_profiles_cv_extraction_status_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_cv_extraction_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "cv_extraction_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "cv_extracted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "cv_extraction_status"`,
    );
  }
}
