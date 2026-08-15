import { MigrationInterface, QueryRunner } from 'typeorm';

export class GuardActiveTaskMatchingRuns1785800000000 implements MigrationInterface {
  name = 'GuardActiveTaskMatchingRuns1785800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `WITH ranked AS (
         SELECT "id",
                ROW_NUMBER() OVER (
                  PARTITION BY "target_task_id"
                  ORDER BY "created_at" DESC, "id" DESC
                ) AS row_number
         FROM "matching_runs"
         WHERE "target_type" = 'task'
           AND "target_task_id" IS NOT NULL
           AND "status" IN ('queued', 'running')
       )
       UPDATE "matching_runs" AS run
       SET "status" = 'cancelled',
           "error" = COALESCE(
             run."error",
             'Cancelled duplicate active task matching run during migration.'
           ),
           "updated_at" = NOW()
       FROM ranked
       WHERE run."id" = ranked."id"
         AND ranked.row_number > 1`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "matching_runs_active_task_uidx"
       ON "matching_runs" ("target_task_id")
       WHERE "target_type" = 'task'
         AND "target_task_id" IS NOT NULL
         AND "status" IN ('queued', 'running')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "matching_runs_active_task_uidx"`,
    );
  }
}
