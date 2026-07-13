import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1784700000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
       ON "notifications" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx"
       ON "notifications" ("user_id", "is_read")
       WHERE "is_read" = false`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_type_status_idx"
       ON "agent_jobs" ("job_type", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_type_status_completed_idx"
       ON "agent_jobs" ("job_type", "status", "completed_at" DESC)
       WHERE "completed_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_type_status_failed_idx"
       ON "agent_jobs" ("job_type", "status", "failed_at" DESC)
       WHERE "failed_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_status_completed_idx"
       ON "agent_jobs" ("status", "completed_at" DESC)
       WHERE "completed_at" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "agent_jobs_status_failed_idx"
       ON "agent_jobs" ("status", "failed_at" DESC)
       WHERE "failed_at" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_user_created_idx"
       ON "freelancer_assessments" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_profile_created_idx"
       ON "freelancer_assessments" ("freelancer_profile_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessments_status_submitted_idx"
       ON "freelancer_assessments" ("status", "submitted_at" DESC, "created_at" DESC)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessment_events_assessment_type_idx"
       ON "freelancer_assessment_events" ("assessment_id", "event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_assessment_questions_assessment_order_idx"
       ON "freelancer_assessment_questions" ("assessment_id", "order_index")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessment_questions_assessment_order_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessment_events_assessment_type_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_status_submitted_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_profile_created_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "freelancer_assessments_user_created_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_status_failed_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_status_completed_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_type_status_failed_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_type_status_completed_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "agent_jobs_type_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "notifications_user_unread_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "notifications_user_created_idx"`,
    );
  }
}
