import { MigrationInterface, QueryRunner } from 'typeorm';

export class FreelancerProfessionalClassification1788500000000 implements MigrationInterface {
  name = 'FreelancerProfessionalClassification1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "freelancer_profiles"
        ADD COLUMN "professional_role" varchar(40),
        ADD COLUMN "seniority_level" varchar(20),
        ADD COLUMN "assessment_target_role" varchar(40),
        ADD COLUMN "assessment_target_seniority" varchar(20),
        ADD COLUMN "classification_source" varchar(20),
        ADD COLUMN "classified_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "freelancer_assessments"
        ADD COLUMN "target_role" varchar(40),
        ADD COLUMN "target_seniority" varchar(20),
        ADD COLUMN "result_role" varchar(40),
        ADD COLUMN "result_seniority" varchar(20)
    `);
    await queryRunner.query(`
      ALTER TABLE "freelancer_profiles"
        ADD CONSTRAINT "freelancer_profiles_professional_role_check"
          CHECK ("professional_role" IS NULL OR "professional_role" IN ('backend','frontend','fullstack','mobile','ui_ux','qa','devops','data','ai_ml','architect')),
        ADD CONSTRAINT "freelancer_profiles_seniority_level_check"
          CHECK ("seniority_level" IS NULL OR "seniority_level" IN ('junior','mid','senior')),
        ADD CONSTRAINT "freelancer_profiles_assessment_target_role_check"
          CHECK ("assessment_target_role" IS NULL OR "assessment_target_role" IN ('backend','frontend','fullstack','mobile','ui_ux','qa','devops','data','ai_ml','architect')),
        ADD CONSTRAINT "freelancer_profiles_assessment_target_seniority_check"
          CHECK ("assessment_target_seniority" IS NULL OR "assessment_target_seniority" IN ('junior','mid','senior')),
        ADD CONSTRAINT "freelancer_profiles_classification_source_check"
          CHECK ("classification_source" IS NULL OR "classification_source" IN ('assessment','admin','migration'))
    `);
    await queryRunner.query(`
      ALTER TABLE "freelancer_assessments"
        ADD CONSTRAINT "freelancer_assessments_target_role_check"
          CHECK ("target_role" IS NULL OR "target_role" IN ('backend','frontend','fullstack','mobile','ui_ux','qa','devops','data','ai_ml','architect')),
        ADD CONSTRAINT "freelancer_assessments_target_seniority_check"
          CHECK ("target_seniority" IS NULL OR "target_seniority" IN ('junior','mid','senior')),
        ADD CONSTRAINT "freelancer_assessments_result_role_check"
          CHECK ("result_role" IS NULL OR "result_role" IN ('backend','frontend','fullstack','mobile','ui_ux','qa','devops','data','ai_ml','architect')),
        ADD CONSTRAINT "freelancer_assessments_result_seniority_check"
          CHECK ("result_seniority" IS NULL OR "result_seniority" IN ('junior','mid','senior'))
    `);
    await queryRunner.query(
      `CREATE INDEX "freelancer_profiles_professional_role_idx" ON "freelancer_profiles" ("professional_role")`,
    );
    await queryRunner.query(
      `CREATE INDEX "freelancer_profiles_seniority_level_idx" ON "freelancer_profiles" ("seniority_level")`,
    );

    await queryRunner.query(`
      WITH inferred AS (
        SELECT id,
          CASE
            WHEN source_text ~* '\\m(architect|architecture|system design)\\M' THEN 'architect'
            WHEN source_text ~* '(ui[ /&-]*ux|user experience|figma|product design)' THEN 'ui_ux'
            WHEN source_text ~* '\\m(ai|machine learning|deep learning|llm|artificial intelligence)\\M' THEN 'ai_ml'
            WHEN source_text ~* '(data engineer|data science|analytics|etl|warehouse|spark)' THEN 'data'
            WHEN source_text ~* '(devops|sre|site reliability|kubernetes|terraform|ci/cd)' THEN 'devops'
            WHEN source_text ~* '(quality assurance|test automation|software tester|testing engineer)' THEN 'qa'
            WHEN source_text ~* '\\m(mobile|android|ios|flutter|react native|swift|kotlin)\\M' THEN 'mobile'
            WHEN source_text ~* 'full[ -]?stack' THEN 'fullstack'
            WHEN source_text ~* '(front[ -]?end|react|angular|vue|next\\.?js)' THEN 'frontend'
            WHEN source_text ~* '(back[ -]?end|nest\\.?js|node\\.?js|spring|django|laravel|\\.net)' THEN 'backend'
            ELSE NULL
          END AS inferred_role
        FROM (
          SELECT id, concat_ws(' ', headline, array_to_string(skills, ' ')) AS source_text
          FROM freelancer_profiles
        ) profile_text
      )
      UPDATE freelancer_profiles profile
      SET professional_role = inferred.inferred_role,
          assessment_target_role = inferred.inferred_role,
          seniority_level = CASE
            WHEN profile.assessment_score::numeric >= 80 THEN 'senior'
            WHEN profile.assessment_score::numeric >= 60 THEN 'mid'
            WHEN profile.assessment_score IS NOT NULL THEN 'junior'
            WHEN profile.years_experience >= 6 THEN 'senior'
            WHEN profile.years_experience >= 3 THEN 'mid'
            ELSE 'junior'
          END,
          assessment_target_seniority = CASE
            WHEN profile.years_experience >= 6 THEN 'senior'
            WHEN profile.years_experience >= 3 THEN 'mid'
            ELSE 'junior'
          END,
          classification_source = 'migration',
          classified_at = now()
      FROM inferred
      WHERE profile.id = inferred.id AND inferred.inferred_role IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "freelancer_profiles_seniority_level_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "freelancer_profiles_professional_role_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_assessments" DROP COLUMN "result_seniority", DROP COLUMN "result_role", DROP COLUMN "target_seniority", DROP COLUMN "target_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles" DROP COLUMN "classified_at", DROP COLUMN "classification_source", DROP COLUMN "assessment_target_seniority", DROP COLUMN "assessment_target_role", DROP COLUMN "seniority_level", DROP COLUMN "professional_role"`,
    );
  }
}
