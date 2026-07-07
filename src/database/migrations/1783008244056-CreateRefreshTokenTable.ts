import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRefreshTokenTable1783008244056 implements MigrationInterface {
    name = 'CreateRefreshTokenTable1783008244056'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" DROP CONSTRAINT "freelancer_profiles_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_customer_id_fkey"`);
        await queryRunner.query(`DROP INDEX "public"."freelancer_profiles_embedding_idx"`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" DROP CONSTRAINT "freelancer_profiles_hourly_rate_check"`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" DROP CONSTRAINT "freelancer_profiles_ratings_count_check"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_budget_max_check"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_budget_min_check"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_check"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_check1"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_held_amount_check"`);
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "projects_released_amount_check"`);
        await queryRunner.query(`CREATE TABLE "refresh-token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" text NOT NULL, "user_id" character varying NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" uuid, CONSTRAINT "PK_62793706ec70c44e0bb5f448923" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" ADD "embedding" vector`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "FK_37efd06fedc3263e4de28ee0935" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh-token" ADD CONSTRAINT "FK_980388a8baa20f67d6610a1afd3" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "FK_8ee9cae5efccf846467e1cb005c" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "projects" DROP CONSTRAINT "FK_8ee9cae5efccf846467e1cb005c"`);
        await queryRunner.query(`ALTER TABLE "refresh-token" DROP CONSTRAINT "FK_980388a8baa20f67d6610a1afd3"`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" DROP CONSTRAINT "FK_37efd06fedc3263e4de28ee0935"`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" DROP COLUMN "embedding"`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" ADD "embedding" vector(1024)`);
        await queryRunner.query(`DROP TABLE "refresh-token"`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_released_amount_check" CHECK ((released_amount >= (0)::numeric))`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_held_amount_check" CHECK ((held_amount >= (0)::numeric))`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_check1" CHECK ((released_amount <= held_amount))`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_check" CHECK ((budget_min <= budget_max))`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_min_check" CHECK ((budget_min >= (0)::numeric))`);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_max_check" CHECK ((budget_max >= (0)::numeric))`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_ratings_count_check" CHECK ((ratings_count >= 0))`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_hourly_rate_check" CHECK (((hourly_rate >= (5)::numeric) AND (hourly_rate <= (200)::numeric)))`);
        await queryRunner.query(`CREATE INDEX "freelancer_profiles_embedding_idx" ON "freelancer_profiles" ("embedding") `);
        await queryRunner.query(`ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "freelancer_profiles" ADD CONSTRAINT "freelancer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
