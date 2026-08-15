import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanningEvaluationContract1785700000000 implements MigrationInterface {
  name = 'AddPlanningEvaluationContract1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_status" varchar(40) NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_score" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_recommendation" varchar(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_requirements" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_result" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_error" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluation_agent_job_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD COLUMN IF NOT EXISTS "evaluated_at" timestamptz`,
    );

    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_evaluation_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_evaluation_status_check"
       CHECK (
         "evaluation_status" IN (
           'pending',
           'pending_architecture',
           'queued',
           'running',
           'completed',
           'failed'
         )
       )`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_evaluation_recommendation_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       ADD CONSTRAINT "project_planning_submissions_evaluation_recommendation_check"
       CHECK (
         "evaluation_recommendation" IS NULL OR
         "evaluation_recommendation" IN ('approve', 'changes_requested', 'reject')
       )`,
    );
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'project_planning_submissions_evaluation_agent_job_id_fk'
         ) THEN
           ALTER TABLE "project_planning_submissions"
           ADD CONSTRAINT "project_planning_submissions_evaluation_agent_job_id_fk"
           FOREIGN KEY ("evaluation_agent_job_id") REFERENCES "agent_jobs"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "project_planning_submissions_evaluation_status_idx"
       ON "project_planning_submissions" ("evaluation_status", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "project_planning_submissions_evaluation_status_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_evaluation_agent_job_id_fk"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_evaluation_recommendation_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP CONSTRAINT IF EXISTS "project_planning_submissions_evaluation_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_planning_submissions"
       DROP COLUMN IF EXISTS "evaluated_at",
       DROP COLUMN IF EXISTS "evaluation_agent_job_id",
       DROP COLUMN IF EXISTS "evaluation_error",
       DROP COLUMN IF EXISTS "evaluation_result",
       DROP COLUMN IF EXISTS "evaluation_requirements",
       DROP COLUMN IF EXISTS "evaluation_recommendation",
       DROP COLUMN IF EXISTS "evaluation_score",
       DROP COLUMN IF EXISTS "evaluation_status"`,
    );
  }
}
