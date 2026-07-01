import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropDuplicateFreelancerProfileUserIdIndex1782913280133 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS freelancer_profiles_user_id_idx`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS freelancer_profiles_user_id_idx
      ON freelancer_profiles(user_id);
    `);
  }
}
