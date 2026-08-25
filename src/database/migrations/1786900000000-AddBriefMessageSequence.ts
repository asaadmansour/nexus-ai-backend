import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brief messages were ordered by `created_at` alone. A customer answer and the
 * agent reply that follows it are written in the same transaction and land on
 * the identical timestamp, so their order was undefined and transcripts could
 * render the reply before the question. See ISSUES.md #12.
 *
 * Adds a per-brief monotonic sequence. The backfill preserves timestamp order
 * and breaks ties by putting the customer message before the agent's reply,
 * which is the only order these pairs can have occurred in.
 */
export class AddBriefMessageSequence1786900000000 implements MigrationInterface {
  name = 'AddBriefMessageSequence1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "brief_messages" ADD COLUMN IF NOT EXISTS "sequence" integer`,
    );
    await queryRunner.query(`
      UPDATE "brief_messages" AS m
         SET "sequence" = ordered.rn
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY brief_id
                   ORDER BY created_at ASC,
                            CASE WHEN sender_type = 'customer' THEN 0 ELSE 1 END,
                            id ASC
                 ) AS rn
            FROM "brief_messages"
        ) AS ordered
       WHERE m.id = ordered.id
    `);
    await queryRunner.query(
      `ALTER TABLE "brief_messages" ALTER COLUMN "sequence" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "brief_messages_brief_id_sequence_uidx"
         ON "brief_messages" ("brief_id", "sequence")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "brief_messages_brief_id_sequence_uidx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "brief_messages" DROP COLUMN IF EXISTS "sequence"`,
    );
  }
}
