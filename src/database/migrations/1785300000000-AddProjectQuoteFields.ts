import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectQuoteFields1785300000000 implements MigrationInterface {
  name = 'AddProjectQuoteFields1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "quoted_amount" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "quoted_currency" char(3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "quote_status" varchar(40) NOT NULL DEFAULT 'not_ready'`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "quote_generated_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "quote_notes" text`,
    );

    await this.addConstraintIfMissing(
      queryRunner,
      'projects_quote_status_check',
      `ALTER TABLE "projects"
       ADD CONSTRAINT "projects_quote_status_check"
       CHECK ("quote_status" IN ('not_ready', 'pending_customer', 'accepted', 'out_of_budget'))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "projects_quote_status_idx"
       ON "projects" ("quote_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "projects_customer_quote_status_idx"
       ON "projects" ("customer_id", "quote_status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "projects_customer_quote_status_idx"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "projects_quote_status_idx"`);
    await queryRunner.query(
      `ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_quote_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "quote_notes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "quote_generated_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "quote_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "quoted_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "quoted_amount"`,
    );
  }

  private async addConstraintIfMissing(
    queryRunner: QueryRunner,
    constraintName: string,
    sql: string,
  ) {
    const exists = await queryRunner.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      [constraintName],
    );
    if (!exists.length) await queryRunner.query(sql);
  }
}
