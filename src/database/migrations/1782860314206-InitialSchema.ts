import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1782860314206 implements MigrationInterface {
  name = 'InitialSchema1782860314206';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ----------------------------------------------------------------
    // Extensions
    // ----------------------------------------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    // ----------------------------------------------------------------
    // Enum types
    // ----------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE user_role AS ENUM ('customer', 'freelancer', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE client_background AS ENUM ('technical', 'product', 'non_technical', 'unknown')`,
    );
    await queryRunner.query(
      `CREATE TYPE project_status AS ENUM ('draft', 'in_progress', 'brief_complete', 'spec_in_progress', 'spec_under_review', 'spec_complete', 'scoped', 'assigned', 'active', 'under_review', 'completed', 'cancelled', 'disputed')`,
    );
    await queryRunner.query(
      `CREATE TYPE milestone_status AS ENUM ('pending', 'active', 'submitted', 'under_review', 'approved', 'revision', 'completed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE task_status AS ENUM ('pending', 'matching', 'assigned', 'in_progress', 'submitted', 'under_review', 'revision', 'completed', 'cancelled', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE assignment_status AS ENUM ('proposed', 'accepted', 'rejected', 'active', 'failed', 'replaced', 'completed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE submission_status AS ENUM ('submitted', 'under_review', 'revision_requested', 'passed', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE spec_status AS ENUM ('draft', 'submitted', 'under_review', 'passed', 'locked', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE payment_direction AS ENUM ('deposit', 'payout', 'refund')`,
    );
    await queryRunner.query(
      `CREATE TYPE payment_processor AS ENUM ('stripe', 'fawry', 'manual_demo')`,
    );
    await queryRunner.query(
      `CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE escrow_type AS ENUM ('hold', 'release', 'deduction', 'refund')`,
    );
    await queryRunner.query(
      `CREATE TYPE escrow_status AS ENUM ('pending', 'confirmed', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE agent_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE actor_type AS ENUM ('user', 'agent', 'system', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE message_sender_type AS ENUM ('client', 'agent', 'system')`,
    );

    // ----------------------------------------------------------------
    // users
    // ----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        first_name varchar(100) NOT NULL,
        last_name varchar(100) NOT NULL,
        email citext UNIQUE NOT NULL,
        phone_number varchar(20) UNIQUE,

        is_email_verified boolean NOT NULL DEFAULT false,
        is_id_verified boolean NOT NULL DEFAULT false,

        hashed_password text,
        photo_url text,

        role user_role NOT NULL DEFAULT 'customer',

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    // ----------------------------------------------------------------
    // freelancer_profiles
    // ----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE freelancer_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

        cv_url text,

        summary jsonb,
        embedding vector(1024),

        hourly_rate numeric(8,2) CHECK (hourly_rate BETWEEN 5 AND 200),

        last_interview_at timestamptz,
        interview_score numeric(5,2),

        is_available boolean NOT NULL DEFAULT true,

        avg_rating numeric(3,2),
        ratings_count int NOT NULL DEFAULT 0 CHECK (ratings_count >= 0),

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(
      `CREATE INDEX freelancer_profiles_embedding_idx ON freelancer_profiles USING hnsw (embedding vector_cosine_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX freelancer_profiles_user_id_idx ON freelancer_profiles(user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX freelancer_profiles_is_available_idx ON freelancer_profiles(is_available)`,
    );

    // ----------------------------------------------------------------
    // projects
    // ----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

        customer_id uuid NOT NULL REFERENCES users(id),

        title varchar(255) NOT NULL,

        budget_min numeric(12,2) NOT NULL CHECK (budget_min >= 0),
        budget_max numeric(12,2) NOT NULL CHECK (budget_max >= 0),
        currency char(3) NOT NULL DEFAULT 'EGP',

        -- cache only; source of truth is escrow_transactions
        held_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (held_amount >= 0),
        released_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),

        status project_status NOT NULL DEFAULT 'draft',

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,

        CHECK (budget_min <= budget_max),
        CHECK (released_amount <= held_amount)
      )
    `);

    await queryRunner.query(
      `CREATE INDEX projects_customer_id_idx ON projects(customer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX projects_status_idx ON projects(status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse dependency order (indexes drop with their table).
    await queryRunner.query(`DROP TABLE IF EXISTS projects`);
    await queryRunner.query(`DROP TABLE IF EXISTS freelancer_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);

    // Drop enum types.
    await queryRunner.query(`DROP TYPE IF EXISTS message_sender_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS actor_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS agent_job_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS escrow_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS escrow_type`);
    await queryRunner.query(`DROP TYPE IF EXISTS payment_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS payment_processor`);
    await queryRunner.query(`DROP TYPE IF EXISTS payment_direction`);
    await queryRunner.query(`DROP TYPE IF EXISTS spec_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS submission_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS assignment_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS task_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS milestone_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS project_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS client_background`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_role`);

    // Extensions are intentionally left in place; they may be shared by other
    // databases/objects and are safe to keep installed.
  }
}
