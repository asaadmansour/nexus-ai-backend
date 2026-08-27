import { MigrationInterface, QueryRunner } from 'typeorm';

export class StagedEscrowWorkflow1787900000000 implements MigrationInterface {
  name = 'StagedEscrowWorkflow1787900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "project_status" ADD VALUE IF NOT EXISTS 'ready_for_implementation_funding'`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD COLUMN IF NOT EXISTS "implementation_capacity_snapshot" jsonb,
       ADD COLUMN IF NOT EXISTS "planning_funded_at" timestamptz,
       ADD COLUMN IF NOT EXISTS "implementation_funded_at" timestamptz`,
    );
    await queryRunner.query(
      `UPDATE "projects"
       SET "planning_funded_at" = COALESCE("assigned_at", "updated_at")
       WHERE "planning_funded_at" IS NULL
         AND COALESCE("held_amount", 0) > 0`,
    );
    await queryRunner.query(
      `UPDATE "projects"
       SET "implementation_funded_at" = COALESCE("assigned_at", "updated_at")
       WHERE "implementation_funded_at" IS NULL
         AND "quoted_amount" IS NOT NULL
         AND "quoted_amount" > 0
         AND COALESCE("held_amount", 0) >= "quoted_amount"`,
    );

    await queryRunner.query(
      `ALTER TABLE "project_payments"
       DROP CONSTRAINT IF EXISTS "project_payments_purpose_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_purpose_check"
       CHECK (
         "purpose" IN (
           'planning_deposit',
           'implementation_deposit',
           'milestone_funding',
           'full_project_deposit',
           'change_request',
           'refund_adjustment'
         )
       )`,
    );

    // Runtime payout code has used these entries since the principal-reviewer
    // and deadline-penalty workflows were introduced. Keeping the older check
    // made an otherwise valid release fail only when the database insert ran.
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP CONSTRAINT IF EXISTS "escrow_ledger_entries_type_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_type_check"
       CHECK (
         "entry_type" IN (
           'hold',
           'release',
           'governance_release',
           'refund',
           'platform_fee',
           'penalty',
           'adjustment'
         )
       )`,
    );

    await queryRunner.query(
      `ALTER TABLE "projects"
       DROP CONSTRAINT IF EXISTS "CHK_projects_accepted_quote_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD CONSTRAINT "CHK_projects_accepted_quote_amount"
       CHECK (
         "quote_status" <> 'accepted'
         OR ("quoted_amount" IS NOT NULL AND "quoted_amount" > 0)
       ) NOT VALID`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects"
       DROP CONSTRAINT IF EXISTS "CHK_projects_accepted_quote_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       DROP CONSTRAINT IF EXISTS "escrow_ledger_entries_type_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrow_ledger_entries"
       ADD CONSTRAINT "escrow_ledger_entries_type_check"
       CHECK (
         "entry_type" IN (
           'hold', 'release', 'refund', 'platform_fee', 'adjustment'
         )
       ) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_payments"
       DROP CONSTRAINT IF EXISTS "project_payments_purpose_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_payments"
       ADD CONSTRAINT "project_payments_purpose_check"
       CHECK (
         "purpose" IN (
           'planning_deposit',
           'milestone_funding',
           'full_project_deposit',
           'change_request',
           'refund_adjustment'
         )
       ) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       DROP COLUMN IF EXISTS "implementation_funded_at",
       DROP COLUMN IF EXISTS "planning_funded_at",
       DROP COLUMN IF EXISTS "implementation_capacity_snapshot"`,
    );
    // PostgreSQL enum values cannot be removed safely while dependent rows may
    // exist; the unused value is intentionally retained on rollback.
  }
}
