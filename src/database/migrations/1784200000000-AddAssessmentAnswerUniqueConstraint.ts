import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssessmentAnswerUniqueConstraint1784200000000 implements MigrationInterface {
  name = 'AddAssessmentAnswerUniqueConstraint1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "freelancer_assessment_answers" a
       USING "freelancer_assessment_answers" b
       WHERE a."assessment_id" = b."assessment_id"
         AND a."question_id" = b."question_id"
         AND (
           a."updated_at" < b."updated_at"
           OR (a."updated_at" = b."updated_at" AND a."id" < b."id")
         )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "freelancer_assessment_answers_assessment_question_uidx"
       ON "freelancer_assessment_answers" ("assessment_id", "question_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."freelancer_assessment_answers_assessment_question_uidx"`,
    );
  }
}
