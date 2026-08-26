import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Completes the fix started in 1786800000000 (ISSUES.md #1), which added
 * `expired` but missed `skipped`.
 *
 * When the principal reviewer picks a lower-ranked candidate, the higher-ranked
 * ones are marked `skipped` with the reason "The principal reviewer selected a
 * lower-ranked candidate". The constraint rejected that value, so the whole
 * selection transaction failed and the reviewer saw "can't do this action" —
 * the reviewer could only ever pick the top-ranked candidate.
 *
 * The list below is the complete set the code writes:
 *   recommended  initial state
 *   shortlisted  reviewer shortlists
 *   invited      invitation sent
 *   selected     reviewer chose them
 *   assigned     invitation accepted
 *   rejected     reviewer rejected, or invitation declined
 *   expired      invitation timed out
 *   skipped      passed over for another candidate
 */
export class AllowSkippedMatchingCandidateStatus1787100000000 implements MigrationInterface {
  name = 'AllowSkippedMatchingCandidateStatus1787100000000';

  private static readonly ALL_STATUSES = [
    'recommended',
    'shortlisted',
    'invited',
    'selected',
    'assigned',
    'rejected',
    'expired',
    'skipped',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" DROP CONSTRAINT IF EXISTS "matching_candidates_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" ADD CONSTRAINT "matching_candidates_status_check"
       CHECK (status IN (${AllowSkippedMatchingCandidateStatus1787100000000.ALL_STATUSES.map(
         (value) => `'${value}'`,
       ).join(', ')}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "matching_candidates" SET status = 'rejected' WHERE status = 'skipped'`,
    );
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" DROP CONSTRAINT IF EXISTS "matching_candidates_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matching_candidates" ADD CONSTRAINT "matching_candidates_status_check"
       CHECK (status IN ('recommended', 'shortlisted', 'invited', 'selected', 'rejected', 'assigned', 'expired'))`,
    );
  }
}
