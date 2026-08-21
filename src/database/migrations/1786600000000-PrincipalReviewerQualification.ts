import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrincipalReviewerQualification1786600000000 implements MigrationInterface {
  name = 'PrincipalReviewerQualification1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "freelancer_profiles"
      ADD COLUMN "principal_reviewer_status" varchar(40) NOT NULL DEFAULT 'not_applied',
      ADD COLUMN "principal_reviewer_applied_at" timestamptz,
      ADD COLUMN "principal_reviewer_reviewed_at" timestamptz,
      ADD COLUMN "principal_reviewer_reviewed_by" uuid,
      ADD COLUMN "principal_reviewer_rejection_reason" text,
      ADD COLUMN "principal_reviewer_hourly_rate" numeric(8,2),
      ADD COLUMN "principal_reviewer_max_projects" integer NOT NULL DEFAULT 3,
      ADD COLUMN "principal_reviewer_qualification" jsonb,
      ADD CONSTRAINT "freelancer_profiles_principal_reviewer_status_ck"
        CHECK ("principal_reviewer_status" IN ('not_applied', 'pending', 'approved', 'rejected', 'suspended')),
      ADD CONSTRAINT "freelancer_profiles_principal_reviewer_max_projects_ck"
        CHECK ("principal_reviewer_max_projects" BETWEEN 1 AND 3),
      ADD CONSTRAINT "freelancer_profiles_principal_reviewer_rate_ck"
        CHECK ("principal_reviewer_hourly_rate" IS NULL OR "principal_reviewer_hourly_rate" > 0),
      ADD CONSTRAINT "freelancer_profiles_principal_reviewer_reviewer_fk"
        FOREIGN KEY ("principal_reviewer_reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "freelancer_profiles_principal_reviewer_status_idx"
       ON "freelancer_profiles" ("principal_reviewer_status", "is_available")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_principal_reviewer_status_idx"`,
    );
    await queryRunner.query(`
      ALTER TABLE "freelancer_profiles"
      DROP CONSTRAINT IF EXISTS "freelancer_profiles_principal_reviewer_reviewer_fk",
      DROP CONSTRAINT IF EXISTS "freelancer_profiles_principal_reviewer_rate_ck",
      DROP CONSTRAINT IF EXISTS "freelancer_profiles_principal_reviewer_max_projects_ck",
      DROP CONSTRAINT IF EXISTS "freelancer_profiles_principal_reviewer_status_ck",
      DROP COLUMN IF EXISTS "principal_reviewer_qualification",
      DROP COLUMN IF EXISTS "principal_reviewer_max_projects",
      DROP COLUMN IF EXISTS "principal_reviewer_hourly_rate",
      DROP COLUMN IF EXISTS "principal_reviewer_rejection_reason",
      DROP COLUMN IF EXISTS "principal_reviewer_reviewed_by",
      DROP COLUMN IF EXISTS "principal_reviewer_reviewed_at",
      DROP COLUMN IF EXISTS "principal_reviewer_applied_at",
      DROP COLUMN IF EXISTS "principal_reviewer_status"
    `);
  }
}
