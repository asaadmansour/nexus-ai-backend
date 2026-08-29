import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowPrincipalReviewerSubmissionReviews1788600000000 implements MigrationInterface {
  name = 'AllowPrincipalReviewerSubmissionReviews1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_submission_reviews"
       DROP CONSTRAINT IF EXISTS "project_submission_reviews_reviewer_role_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_reviewer_role_check"
       CHECK (
         "reviewer_role" IN (
           'admin',
           'customer',
           'principal_reviewer',
           'ai',
           'system'
         )
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_submission_reviews"
       DROP CONSTRAINT IF EXISTS "project_submission_reviews_reviewer_role_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_submission_reviews"
       ADD CONSTRAINT "project_submission_reviews_reviewer_role_check"
       CHECK (
         "reviewer_role" IN ('admin', 'customer', 'ai', 'system')
       ) NOT VALID`,
    );
  }
}
