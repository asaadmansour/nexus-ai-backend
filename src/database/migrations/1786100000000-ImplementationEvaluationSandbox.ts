import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImplementationEvaluationSandbox1786100000000 implements MigrationInterface {
  name = 'ImplementationEvaluationSandbox1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "evaluation_runs"
       ADD COLUMN "trigger" varchar(120),
       ADD COLUMN "evaluated_commit_sha" varchar(64),
       ADD COLUMN "evidence_bundle" jsonb`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "evaluation_runs_submission_active_uidx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "evaluation_runs_submission_active_uidx"
       ON "evaluation_runs" ("submission_id")
       WHERE "submission_id" IS NOT NULL
         AND "status" IN ('queued', 'running')`,
    );
    await queryRunner.query(
      `CREATE INDEX "evaluation_runs_submission_commit_idx"
       ON "evaluation_runs" ("submission_id", "evaluated_commit_sha", "created_at" DESC)
       WHERE "submission_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "github_webhook_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "delivery_id" varchar(120) NOT NULL,
        "event_type" varchar(120) NOT NULL,
        "repository_full_name" varchar(320),
        "payload" jsonb NOT NULL,
        "processed_at" timestamptz,
        "processing_started_at" timestamptz,
        "processing_error" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "github_webhook_events_pkey" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "github_webhook_events_delivery_uidx"
       ON "github_webhook_events" ("delivery_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "github_webhook_events_type_created_idx"
       ON "github_webhook_events" ("event_type", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "github_webhook_events"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "evaluation_runs_submission_commit_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "evaluation_runs_submission_active_uidx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "evaluation_runs_submission_active_uidx"
       ON "evaluation_runs" ("submission_id")
       WHERE "submission_id" IS NOT NULL
         AND "status" IN ('queued', 'running', 'completed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "evaluation_runs"
       DROP COLUMN IF EXISTS "evidence_bundle",
       DROP COLUMN IF EXISTS "evaluated_commit_sha",
       DROP COLUMN IF EXISTS "trigger"`,
    );
  }
}
