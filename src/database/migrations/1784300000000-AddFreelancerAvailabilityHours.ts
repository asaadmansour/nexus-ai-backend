import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFreelancerAvailabilityHours1784300000000 implements MigrationInterface {
  name = 'AddFreelancerAvailabilityHours1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       ADD COLUMN IF NOT EXISTS "availability_hours_per_week" integer`,
    );
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1
           FROM pg_constraint
           WHERE conname = 'freelancer_profiles_availability_hours_check'
         ) THEN
           ALTER TABLE "freelancer_profiles"
           ADD CONSTRAINT "freelancer_profiles_availability_hours_check"
           CHECK ("availability_hours_per_week" IS NULL OR ("availability_hours_per_week" >= 0 AND "availability_hours_per_week" <= 168));
         END IF;
       END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP CONSTRAINT IF EXISTS "freelancer_profiles_availability_hours_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "freelancer_profiles"
       DROP COLUMN IF EXISTS "availability_hours_per_week"`,
    );
  }
}
