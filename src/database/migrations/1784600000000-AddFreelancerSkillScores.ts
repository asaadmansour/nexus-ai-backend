import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFreelancerSkillScores1784600000000 implements MigrationInterface {
  name = 'AddFreelancerSkillScores1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "freelancer_skill_scores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "freelancer_profile_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "assessment_id" uuid,
        "skill" varchar(120) NOT NULL,
        "score" numeric(3,2) NOT NULL,
        "confidence" numeric(3,2),
        "evidence" text,
        "source" varchar(40) NOT NULL DEFAULT 'assessment',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "freelancer_skill_scores_profile_fk"
          FOREIGN KEY ("freelancer_profile_id")
          REFERENCES "freelancer_profiles"("id")
          ON DELETE CASCADE,
        CONSTRAINT "freelancer_skill_scores_user_fk"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "freelancer_skill_scores_assessment_fk"
          FOREIGN KEY ("assessment_id")
          REFERENCES "freelancer_assessments"("id")
          ON DELETE SET NULL,
        CONSTRAINT "freelancer_skill_scores_score_check"
          CHECK ("score" >= 0 AND "score" <= 5),
        CONSTRAINT "freelancer_skill_scores_confidence_check"
          CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "freelancer_skill_scores_profile_skill_uidx"
       ON "freelancer_skill_scores" ("freelancer_profile_id", "skill")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_skill_scores_user_score_idx"
       ON "freelancer_skill_scores" ("user_id", "score")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "freelancer_skill_scores_assessment_idx"
       ON "freelancer_skill_scores" ("assessment_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "freelancer_skill_scores"`);
  }
}
