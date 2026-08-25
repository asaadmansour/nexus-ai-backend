import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `expireInvitation()` marks the linked candidate row `expired`, but the check
 * constraint never allowed that value. Every expiry attempt therefore threw
 * (code 23514) and retried forever, and — because accepting an invitation runs
 * the same expiry path first — a freelancer whose invitation had timed out could
 * neither accept nor decline it. See ISSUES.md #1.
 */
export class AllowExpiredMatchingCandidateStatus1786800000000
  implements MigrationInterface
{
  name = 'AllowExpiredMatchingCandidateStatus1786800000000';

  private static readonly WITH_EXPIRED = [
    'recommended',
    'shortlisted',
    'invited',
    'selected',
    'rejected',
    'assigned',
    'expired',
  ];

  private static readonly WITHOUT_EXPIRED = [
    'recommended',
    'shortlisted',
    'invited',
    'selected',
    'rejected',
    'assigned',
  ];

  private static check(values: string[]) {
    return values.map((value) => `'${value}'`).join(', ');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" DROP CONSTRAINT IF EXISTS "matching_candidates_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" ADD CONSTRAINT "matching_candidates_status_check"
       CHECK (status IN (${AllowExpiredMatchingCandidateStatus1786800000000.check(
         AllowExpiredMatchingCandidateStatus1786800000000.WITH_EXPIRED,
       )}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows already marked expired would violate the narrower rule, so retire
    // them to 'rejected' before restoring it.
    await queryRunner.query(
      `UPDATE "matching_candidates" SET status = 'rejected' WHERE status = 'expired'`,
    );
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" DROP CONSTRAINT IF EXISTS "matching_candidates_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" ADD CONSTRAINT "matching_candidates_status_check"
       CHECK (status IN (${AllowExpiredMatchingCandidateStatus1786800000000.check(
         AllowExpiredMatchingCandidateStatus1786800000000.WITHOUT_EXPIRED,
       )}))`,
    );
  }
}
