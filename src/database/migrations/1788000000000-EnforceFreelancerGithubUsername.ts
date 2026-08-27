import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceFreelancerGithubUsername1788000000000 implements MigrationInterface {
  name = 'EnforceFreelancerGithubUsername1788000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_github_username_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ALTER COLUMN "github_username" TYPE varchar(39)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "freelancer_profiles_github_username_uidx"
       ON "freelancer_profiles" (LOWER("github_username"))
       WHERE "github_username" IS NOT NULL`,
    );
    // Existing accounts may still need an explicit backfill. NOT VALID keeps
    // the migration deployable while enforcing the rule for every new or
    // subsequently updated profile row.
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD CONSTRAINT "freelancer_profiles_github_username_required_ck"
       CHECK (
         "github_username" IS NOT NULL
         AND length("github_username") BETWEEN 1 AND 39
         AND "github_username" ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'
       ) NOT VALID`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_github_username_required_ck"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_profiles_github_username_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ALTER COLUMN "github_username" TYPE varchar(120)`,
    );
    await queryRunner.query(
      `CREATE INDEX "freelancer_profiles_github_username_idx"
       ON "freelancer_profiles" ("github_username")
       WHERE "github_username" IS NOT NULL`,
    );
  }
}
