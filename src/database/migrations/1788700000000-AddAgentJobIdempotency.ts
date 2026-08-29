import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgentJobIdempotency1788700000000 implements MigrationInterface {
  name = 'AddAgentJobIdempotency1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_jobs" ADD COLUMN "idempotency_key" varchar(160)`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "agent_jobs_idempotency_uidx"
      ON "agent_jobs" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_idempotency_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_jobs" DROP COLUMN IF EXISTS "idempotency_key"`,
    );
  }
}
