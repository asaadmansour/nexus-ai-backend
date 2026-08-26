import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationIncidentsAndQuoteEvidence1787500000000 implements MigrationInterface {
  name = 'AddAutomationIncidentsAndQuoteEvidence1787500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_incidents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fingerprint" character varying(64) NOT NULL,
        "project_id" uuid,
        "subsystem" character varying(50) NOT NULL,
        "operation" character varying(100) NOT NULL,
        "error_code" character varying(80) NOT NULL,
        "severity" character varying(20) NOT NULL DEFAULT 'error',
        "status" character varying(20) NOT NULL DEFAULT 'open',
        "message" text NOT NULL,
        "context" jsonb,
        "occurrence_count" integer NOT NULL DEFAULT 1,
        "first_occurred_at" timestamptz NOT NULL,
        "last_occurred_at" timestamptz NOT NULL,
        "resolved_at" timestamptz,
        "resolution_note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_incidents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_automation_incidents_fingerprint" UNIQUE ("fingerprint"),
        CONSTRAINT "FK_automation_incidents_project" FOREIGN KEY ("project_id")
          REFERENCES "projects"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "automation_incidents_status_last_idx"
       ON "automation_incidents" ("status", "last_occurred_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "automation_incidents_project_idx"
       ON "automation_incidents" ("project_id", "last_occurred_at" DESC)`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "quote_evidence" jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects" DROP COLUMN IF EXISTS "quote_evidence"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_incidents"`);
  }
}
