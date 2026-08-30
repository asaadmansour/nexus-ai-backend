import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeMilestoneSubmissionVersions1788900000000
  implements MigrationInterface
{
  name = 'ScopeMilestoneSubmissionVersions1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_submissions_milestone_freelancer_version_uidx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_submissions_milestone_freelancer_version_uidx"
       ON "project_submissions" ("milestone_id", "freelancer_profile_id", "version")
       WHERE "task_id" IS NULL
         AND "milestone_id" IS NOT NULL
         AND "freelancer_profile_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_submissions_milestone_freelancer_version_uidx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "project_submissions_milestone_freelancer_version_uidx"
       ON "project_submissions" ("milestone_id", "freelancer_profile_id", "version")
       WHERE "milestone_id" IS NOT NULL
         AND "freelancer_profile_id" IS NOT NULL`,
    );
  }
}
