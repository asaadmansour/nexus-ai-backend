import { MigrationInterface, QueryRunner } from 'typeorm';

export class SettleProjectCompletionSurplus1788800000000 implements MigrationInterface {
  name = 'SettleProjectCompletionSurplus1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "escrow_ledger_entries_project_completion_refund_uidx"
      ON "escrow_ledger_entries" ("project_id")
      WHERE "entry_type" = 'refund'
        AND "status" = 'posted'
        AND "metadata"->>'refundType' = 'project_completion_surplus'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "escrow_ledger_entries_project_completion_refund_uidx"`,
    );
  }
}
