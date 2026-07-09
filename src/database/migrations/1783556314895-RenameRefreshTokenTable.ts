import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameRefreshTokenTable1783556314895 implements MigrationInterface {
  name = 'RenameRefreshTokenTable1783556314895';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh-token" RENAME TO "refresh_tokens"`,
    );
    await queryRunner.query(
      `ALTER INDEX "PK_62793706ec70c44e0bb5f448923" RENAME TO "PK_7d8bee0204106019488c4c50ffa"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" RENAME TO "refresh-token"`,
    );
    await queryRunner.query(
      `ALTER INDEX "PK_7d8bee0204106019488c4c50ffa" RENAME TO "PK_62793706ec70c44e0bb5f448923"`,
    );
  }
}
