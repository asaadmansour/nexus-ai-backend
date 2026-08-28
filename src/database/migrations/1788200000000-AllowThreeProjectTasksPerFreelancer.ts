import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowThreeProjectTasksPerFreelancer1788200000000 implements MigrationInterface {
  name = 'AllowThreeProjectTasksPerFreelancer1788200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_invitations_active_profile_uidx"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_invitations_active_profile_project_idx"
       ON "project_invitations" ("freelancer_profile_id", "project_id")
       WHERE "status" IN ('pending', 'accepting')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_invitations_active_profile_project_idx"`,
    );
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                ROW_NUMBER() OVER (
                  PARTITION BY "freelancer_profile_id"
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "project_invitations"
         WHERE "status" IN ('pending', 'accepting')
       )
       UPDATE "project_invitations" AS invitation
       SET "status" = 'cancelled',
           "responded_at" = COALESCE(invitation."responded_at", NOW()),
           "response_reason" = COALESCE(
             invitation."response_reason",
             'Cancelled while restoring the single active invitation policy'
           )
       FROM ranked
       WHERE invitation."id" = ranked."id" AND ranked.rn > 1`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "project_invitations_active_profile_uidx"
       ON "project_invitations" ("freelancer_profile_id")
       WHERE "status" IN ('pending', 'accepting')`,
    );
  }
}
