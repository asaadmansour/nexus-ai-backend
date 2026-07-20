import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssignmentRoleBrief1785400000000
  implements MigrationInterface
{
  name = 'AddAssignmentRoleBrief1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      ADD COLUMN IF NOT EXISTS "role_brief" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      ADD COLUMN IF NOT EXISTS "role_brief_status" varchar(40) NOT NULL DEFAULT 'pending'
    `);
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      ADD COLUMN IF NOT EXISTS "role_brief_generated_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      ADD COLUMN IF NOT EXISTS "role_brief_error" text
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "project_role_assignments_role_brief_status_idx"
      ON "project_role_assignments" ("role_brief_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_role_assignments_role_brief_status_idx"`,
    );
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      DROP COLUMN IF EXISTS "role_brief_error"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      DROP COLUMN IF EXISTS "role_brief_generated_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      DROP COLUMN IF EXISTS "role_brief_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "project_role_assignments"
      DROP COLUMN IF EXISTS "role_brief"
    `);
  }
}
