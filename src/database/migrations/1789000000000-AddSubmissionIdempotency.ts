import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubmissionIdempotency1789000000000
  implements MigrationInterface
{
  name = 'AddSubmissionIdempotency1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_submissions" ADD COLUMN "idempotency_key" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_submissions_create_request_uidx"
       ON "project_submissions" ("idempotency_key")
       WHERE "idempotency_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_submissions_create_request_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submissions" DROP COLUMN "idempotency_key"`,
    );
  }
}
