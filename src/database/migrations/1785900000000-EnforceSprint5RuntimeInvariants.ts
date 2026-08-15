import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSprint5RuntimeInvariants1785900000000 implements MigrationInterface {
  name = 'EnforceSprint5RuntimeInvariants1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "briefs"
       ALTER COLUMN "missing_fields" SET DEFAULT '{}'::text[]`,
    );

    // The default was needed only while the delivery column was backfilled.
    // Runtime writes always provide a validated submission type.
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       ALTER COLUMN "submission_type" DROP DEFAULT`,
    );

    // A submission can fund at most one posted release, even if two release
    // requests race or application-level idempotency is accidentally bypassed.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "escrow_ledger_entries_submission_release_uidx"
       ON "escrow_ledger_entries" ("approved_submission_id")
       WHERE "approved_submission_id" IS NOT NULL
         AND "entry_type" = 'release'
         AND "status" = 'posted'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "escrow_ledger_entries_submission_release_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       ALTER COLUMN "submission_type" SET DEFAULT 'text'`,
    );
    await queryRunner.query(
      `ALTER TABLE "briefs"
       ALTER COLUMN "missing_fields" SET DEFAULT ARRAY[]::text[]`,
    );
  }
}
