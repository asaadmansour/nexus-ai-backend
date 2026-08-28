import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowSendingRepositoryCollaboratorStatus1788400000000 implements MigrationInterface {
  name = 'AllowSendingRepositoryCollaboratorStatus1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       DROP CONSTRAINT IF EXISTS "repository_collaborators_invite_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_invite_status_check"
       CHECK (
         "invite_status" IN (
           'pending',
           'sending',
           'missing_username',
           'invited',
           'accepted',
           'declined',
           'removed',
           'failed'
         )
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "repository_collaborators"
       SET "invite_status" = 'failed',
           "metadata" = COALESCE("metadata", '{}'::jsonb) ||
             '{"error":"Invite was interrupted while being sent"}'::jsonb
       WHERE "invite_status" = 'sending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       DROP CONSTRAINT IF EXISTS "repository_collaborators_invite_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "repository_collaborators"
       ADD CONSTRAINT "repository_collaborators_invite_status_check"
       CHECK (
         "invite_status" IN (
           'pending',
           'missing_username',
           'invited',
           'accepted',
           'declined',
           'removed',
           'failed'
         )
       )`,
    );
  }
}
