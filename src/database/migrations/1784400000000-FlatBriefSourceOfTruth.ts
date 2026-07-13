import { MigrationInterface, QueryRunner } from 'typeorm';

type JsonObject = Record<string, unknown>;

interface BriefBackfillRow {
  id: string;
  technical: JsonObject | null;
  non_functional: JsonObject | null;
  deliverables: JsonObject | null;
  ai_decided: JsonObject | null;
}

const NEW_COLUMNS = [
  ['main_goal', 'text'],
  ['target_users', 'text'],
  ['core_features', 'text'],
  ['platforms', 'text'],
  ['budget', 'text'],
  ['deadline_text', 'text'],
  ['deliverables_text', 'text'],
  ['constraints_preferences', 'text'],
  ['missing_fields', 'text[] NOT NULL DEFAULT ARRAY[]::text[]'],
  ['completion_percentage', 'integer NOT NULL DEFAULT 0'],
  ['ai_revision_open', 'boolean NOT NULL DEFAULT false'],
  ['revision_count', 'integer NOT NULL DEFAULT 0'],
  ['revision_limit', 'integer NOT NULL DEFAULT 3'],
  ['confirmed_at', 'timestamptz'],
  ['confirmed_by', 'uuid'],
  ['manually_edited_at', 'timestamptz'],
  ['reopened_at', 'timestamptz'],
  ['pending_field', 'varchar(80)'],
  ['next_question_field', 'varchar(80)'],
  ['extraction_source', 'varchar(80)'],
  ['ai_source', 'varchar(40)'],
  ['extracted_fields', 'jsonb'],
] as const;

export class FlatBriefSourceOfTruth1784400000000 implements MigrationInterface {
  name = 'FlatBriefSourceOfTruth1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, type] of NEW_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
      );
    }

    await this.backfillExistingBriefs(queryRunner);

    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'briefs_completion_percentage_check'
         ) THEN
           ALTER TABLE "briefs"
           ADD CONSTRAINT "briefs_completion_percentage_check"
           CHECK ("completion_percentage" >= 0 AND "completion_percentage" <= 100);
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'briefs_revision_count_check'
         ) THEN
           ALTER TABLE "briefs"
           ADD CONSTRAINT "briefs_revision_count_check"
           CHECK ("revision_count" >= 0 AND "revision_limit" >= 0);
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "briefs_domain_complete_idx"
       ON "briefs" ("domain", "is_complete")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "briefs_experience_level_idx"
       ON "briefs" ("experience_level", "experience_min_years")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "briefs_revision_open_idx"
       ON "briefs" ("ai_revision_open")
       WHERE "ai_revision_open" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "briefs_revision_open_idx"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "briefs_experience_level_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "briefs_domain_complete_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_revision_count_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_completion_percentage_check"`,
    );

    for (const [name] of [...NEW_COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "briefs" DROP COLUMN IF EXISTS "${name}"`,
      );
    }
  }

  private async backfillExistingBriefs(queryRunner: QueryRunner) {
    const rows = (await queryRunner.query(
      `SELECT "id", "technical", "non_functional", "deliverables", "ai_decided"
       FROM "briefs"`,
    )) as BriefBackfillRow[];

    for (const row of rows) {
      const aiDecided = this.asObject(row.ai_decided);
      const extractedFields = this.asObject(aiDecided?.extractedFields) ?? {};
      const technical = this.asObject(row.technical) ?? {};
      const nonFunctional = this.asObject(row.non_functional) ?? {};
      const deliverables = this.asObject(row.deliverables) ?? {};

      await queryRunner.query(
        `UPDATE "briefs"
         SET
           "main_goal" = COALESCE("main_goal", $1),
           "target_users" = COALESCE("target_users", $2),
           "core_features" = COALESCE("core_features", $3),
           "platforms" = COALESCE("platforms", $4),
           "budget" = COALESCE("budget", $5),
           "deadline_text" = COALESCE("deadline_text", $6),
           "deliverables_text" = COALESCE("deliverables_text", $7),
           "constraints_preferences" = COALESCE("constraints_preferences", $8),
           "missing_fields" = CASE
             WHEN cardinality("missing_fields") = 0 THEN $9::text[]
             ELSE "missing_fields"
           END,
           "completion_percentage" = CASE
             WHEN "completion_percentage" = 0 THEN $10
             ELSE "completion_percentage"
           END,
           "ai_revision_open" = COALESCE($11, "ai_revision_open"),
           "revision_count" = GREATEST("revision_count", $12),
           "revision_limit" = GREATEST("revision_limit", $13),
           "confirmed_at" = COALESCE("confirmed_at", $14),
           "confirmed_by" = COALESCE("confirmed_by", $15),
           "manually_edited_at" = COALESCE("manually_edited_at", $16),
           "reopened_at" = COALESCE("reopened_at", $17),
           "pending_field" = COALESCE("pending_field", $18),
           "next_question_field" = COALESCE("next_question_field", $19),
           "extraction_source" = COALESCE("extraction_source", $20),
           "ai_source" = COALESCE("ai_source", $21),
           "extracted_fields" = COALESCE("extracted_fields", $22::jsonb)
         WHERE "id" = $23`,
        [
          this.toText(technical.mainGoal ?? extractedFields.mainGoal),
          this.toText(technical.targetUsers ?? extractedFields.targetUsers),
          this.toText(technical.coreFeatures ?? extractedFields.coreFeatures),
          this.toText(technical.platforms ?? extractedFields.platforms),
          this.toText(nonFunctional.budget ?? extractedFields.budget),
          this.toText(nonFunctional.deadline ?? extractedFields.deadline),
          this.toText(deliverables.items ?? extractedFields.deliverables),
          this.toText(
            nonFunctional.constraintsPreferences ??
              extractedFields.constraintsPreferences,
          ),
          this.toTextArray(aiDecided?.missingFields),
          this.toInteger(aiDecided?.completionPercentage) ?? 0,
          typeof aiDecided?.aiRevisionOpen === 'boolean'
            ? aiDecided.aiRevisionOpen
            : null,
          this.toInteger(aiDecided?.revisionCount) ?? 0,
          this.toInteger(aiDecided?.revisionLimit) ?? 3,
          this.toDate(aiDecided?.confirmedAt),
          this.toUuid(aiDecided?.confirmedBy),
          this.toDate(aiDecided?.manuallyEditedAt),
          this.toDate(aiDecided?.reopenedAt),
          this.toText(aiDecided?.pendingField),
          this.toText(aiDecided?.nextQuestionField),
          this.toText(aiDecided?.extractionSource),
          this.toText(aiDecided?.source),
          JSON.stringify(
            Object.keys(extractedFields).length > 0 ? extractedFields : null,
          ),
          row.id,
        ],
      );
    }
  }

  private asObject(value: unknown): JsonObject | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  }

  private toText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    if (typeof value === 'string') return value.trim() || null;
    if (Array.isArray(value)) {
      const text = value
        .map((item) => this.toText(item))
        .filter((item): item is string => Boolean(item))
        .join(', ');
      return text || null;
    }
    return null;
  }

  private toTextArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.toText(item))
      .filter((item): item is string => Boolean(item));
  }

  private toInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value !== 'string') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private toDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toUuid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
      ? value
      : null;
  }
}
