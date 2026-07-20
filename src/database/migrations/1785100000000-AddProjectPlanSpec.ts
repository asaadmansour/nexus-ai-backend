import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectPlanSpec1785100000000 implements MigrationInterface {
  name = 'AddProjectPlanSpec1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_plans"
       ADD COLUMN IF NOT EXISTS "project_spec" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_plans"
       DROP COLUMN IF EXISTS "project_spec"`,
    );
  }
}
