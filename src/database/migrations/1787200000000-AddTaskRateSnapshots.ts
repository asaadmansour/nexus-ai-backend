import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Freezes the freelancer's agreed hourly rate on an implementation task when it
 * is assigned. Planning assignments already have this contract snapshot; tasks
 * previously read the mutable freelancer profile at payout time.
 *
 * Existing active assignments are backfilled from the current profile as the
 * only rate evidence available for legacy rows. New assignments are snapshotted
 * by MatchingService at the moment the invitation is accepted.
 */
export class AddTaskRateSnapshots1787200000000 implements MigrationInterface {
  name = 'AddTaskRateSnapshots1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
         ADD COLUMN IF NOT EXISTS "hourly_rate_snapshot" numeric(8,2),
         ADD COLUMN IF NOT EXISTS "hourly_rate_currency_snapshot" character varying(3)`,
    );
    await queryRunner.query(
      `UPDATE "project_tasks" task
          SET "hourly_rate_snapshot" = profile."hourly_rate",
              "hourly_rate_currency_snapshot" = profile."hourly_rate_currency"
         FROM "freelancer_profiles" profile
        WHERE task."assigned_freelancer_profile_id" = profile."id"
          AND task."hourly_rate_snapshot" IS NULL
          AND profile."hourly_rate" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
         ADD CONSTRAINT "project_tasks_hourly_rate_currency_snapshot_check"
         CHECK (
           "hourly_rate_currency_snapshot" IS NULL OR
           "hourly_rate_currency_snapshot" IN ('EGP', 'USD', 'EUR', 'GBP')
         )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
         DROP CONSTRAINT IF EXISTS "project_tasks_hourly_rate_currency_snapshot_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_tasks"
         DROP COLUMN IF EXISTS "hourly_rate_currency_snapshot",
         DROP COLUMN IF EXISTS "hourly_rate_snapshot"`,
    );
  }
}
