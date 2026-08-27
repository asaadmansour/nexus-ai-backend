import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandProjectPlanningStatuses1788100000000 implements MigrationInterface {
  name = 'ExpandProjectPlanningStatuses1788100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects"
       DROP CONSTRAINT IF EXISTS "projects_planning_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD CONSTRAINT "projects_planning_status_check"
       CHECK (
         "planning_status" IN (
           'not_started',
           'matching',
           'assigned',
           'in_progress',
           'under_review',
           'approved',
           'changes_requested',
           'completed',
           'cancelled',
           'team_confirmed',
           'waiting_for_pr'
         )
       )`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects"
       DROP CONSTRAINT IF EXISTS "projects_planning_status_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "projects"
       ADD CONSTRAINT "projects_planning_status_check"
       CHECK (
         "planning_status" IN (
           'not_started',
           'matching',
           'assigned',
           'in_progress',
           'under_review',
           'approved',
           'changes_requested',
           'completed',
           'cancelled'
         )
       ) NOT VALID`,
    );
  }
}
