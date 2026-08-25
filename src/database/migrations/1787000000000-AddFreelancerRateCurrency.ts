import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `hourly_rate` was a bare number with no unit, while projects carry a currency
 * (EGP, USD or EUR). Matching compared an EGP budget straight against a rate
 * that was almost certainly USD, so no comparison was ever like-for-like. It
 * failed safe here — nothing matched — but the same bug can fail unsafe, letting
 * an EGP budget clear a USD rate check and committing the platform to pay far
 * more than the customer agreed. See ISSUES.md #9.
 *
 * Existing rates (20-40 for developers, 55 for the principal reviewer) are USD
 * figures — the same numbers read as EGP would be below minimum wage — so USD is
 * the backfill.
 */
export class AddFreelancerRateCurrency1787000000000
  implements MigrationInterface
{
  name = 'AddFreelancerRateCurrency1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
         ADD COLUMN IF NOT EXISTS "hourly_rate_currency" character varying(3)`,
    );
    await queryRunner.query(
      `UPDATE "freelancer_profiles" SET "hourly_rate_currency" = 'USD'
        WHERE "hourly_rate_currency" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
         ALTER COLUMN "hourly_rate_currency" SET DEFAULT 'USD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
         ALTER COLUMN "hourly_rate_currency" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
         ADD CONSTRAINT "freelancer_profiles_hourly_rate_currency_check"
         CHECK ("hourly_rate_currency" IN ('EGP', 'USD', 'EUR', 'GBP'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
         DROP CONSTRAINT IF EXISTS "freelancer_profiles_hourly_rate_currency_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
         DROP COLUMN IF EXISTS "hourly_rate_currency"`,
    );
  }
}
