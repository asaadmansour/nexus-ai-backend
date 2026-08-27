import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationIncidentEvents1787800000000 implements MigrationInterface {
  name = 'AddAutomationIncidentEvents1787800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_incident_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "incident_id" uuid NOT NULL,
        "event_type" character varying(20) NOT NULL,
        "severity" character varying(20) NOT NULL,
        "message" text NOT NULL,
        "context" jsonb,
        "trace" text,
        "occurred_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_incident_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_incident_events_incident" FOREIGN KEY ("incident_id")
          REFERENCES "automation_incidents"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "automation_incident_events_incident_idx"
       ON "automation_incident_events" ("incident_id", "occurred_at" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "automation_incident_events"`,
    );
  }
}
