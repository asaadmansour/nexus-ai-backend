import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBriefDocuments1787300000000 implements MigrationInterface {
  name = 'AddBriefDocuments1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "brief_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "brief_id" uuid NOT NULL,
        "uploaded_by_user_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "mime_type" character varying(150) NOT NULL,
        "size_bytes" integer NOT NULL,
        "sha256" character varying(64) NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'queued',
        "scan_status" character varying(30) NOT NULL,
        "storage_public_id" character varying(500) NOT NULL,
        "storage_version" bigint NOT NULL,
        "storage_format" character varying(20) NOT NULL,
        "processing_attempts" integer NOT NULL DEFAULT 0,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "extracted_fields" jsonb,
        "summary" text,
        "warnings" jsonb,
        "error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brief_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_brief_documents_brief"
          FOREIGN KEY ("brief_id") REFERENCES "briefs"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_brief_documents_uploader"
          FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_brief_documents_brief_created"
         ON "brief_documents" ("brief_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_brief_documents_uploader_created"
         ON "brief_documents" ("uploaded_by_user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_brief_documents_active_hash"
         ON "brief_documents" ("brief_id", "sha256")
         WHERE "status" IN ('queued', 'processing', 'processed')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "brief_documents"`);
  }
}
