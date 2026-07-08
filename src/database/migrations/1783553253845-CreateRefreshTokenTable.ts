import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokenTable1783553253845 implements MigrationInterface {
  name = 'CreateRefreshTokenTable1783553253845';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refresh-token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" text NOT NULL, "user_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_62793706ec70c44e0bb5f448923" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh-token" ADD CONSTRAINT "FK_0f25c0e45e3acbd833ca32ea671" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh-token" DROP CONSTRAINT "FK_0f25c0e45e3acbd833ca32ea671"`,
    );
    await queryRunner.query(`DROP TABLE "refresh-token"`);
  }
}
