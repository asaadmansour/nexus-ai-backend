import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSprint5DeliveryContract1785600000000 implements MigrationInterface {
  name = 'AddSprint5DeliveryContract1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       ADD COLUMN IF NOT EXISTS "submission_type" varchar(40) NOT NULL DEFAULT 'text'`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       DROP CONSTRAINT IF EXISTS "project_submissions_type_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       ADD CONSTRAINT "project_submissions_type_check"
       CHECK (
         "submission_type" IN (
           'pull_request',
           'repository',
           'file',
           'text',
           'figma'
         )
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_submissions_project_type_idx"
       ON "project_submissions" ("project_id", "submission_type")`,
    );

    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       ADD COLUMN IF NOT EXISTS "metadata" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP COLUMN IF EXISTS "metadata"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_submissions_project_type_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       DROP CONSTRAINT IF EXISTS "project_submissions_type_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submissions"
       DROP COLUMN IF EXISTS "submission_type"`,
    );
  }
}
