import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema: extensions, enum types, and the core tables
 * (users, freelancer_profiles, projects) with their indexes.
 *
 * Written to be idempotent for extensions and enum types (guarded with
 * IF NOT EXISTS) so it runs cleanly on both the already-provisioned
 * Supabase instance and a fresh database.
 */
export class InitialSchema1782913280132 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Extensions -------------------------------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    // --- Enum types (only those used by the tables below) -----------------
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
          CREATE TYPE user_role AS ENUM ('customer', 'freelancer', 'admin');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
          CREATE TYPE project_status AS ENUM (
            'draft', 'in_progress', 'brief_complete', 'spec_in_progress',
            'spec_under_review', 'spec_complete', 'scoped', 'assigned',
            'active', 'under_review', 'completed', 'cancelled', 'disputed'
          );
        END IF;
      END $$;
    `);

    // --- USERS ------------------------------------------------------------
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
      );
    `);

    // --- FREELANCER PROFILES ---------------------------------------------
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
      );
    `);

    await queryRunner.query(`
      CREATE INDEX freelancer_profiles_embedding_idx
      ON freelancer_profiles USING hnsw (embedding vector_cosine_ops);
    `);
    await queryRunner.query(`
      CREATE INDEX freelancer_profiles_user_id_idx
      ON freelancer_profiles(user_id);
    `);
    await queryRunner.query(`
      CREATE INDEX freelancer_profiles_is_available_idx
      ON freelancer_profiles(is_available);
    `);

    // --- PROJECTS ---------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES users(id),
        title varchar(255) NOT NULL,
        budget_min numeric(12,2) NOT NULL CHECK (budget_min >= 0),
        budget_max numeric(12,2) NOT NULL CHECK (budget_max >= 0),
        currency char(3) NOT NULL DEFAULT 'EGP',
        held_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (held_amount >= 0),
        released_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
        status project_status NOT NULL DEFAULT 'draft',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CHECK (budget_min <= budget_max),
        CHECK (released_amount <= held_amount)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX projects_customer_id_idx ON projects(customer_id);
    `);
    await queryRunner.query(`
      CREATE INDEX projects_status_idx ON projects(status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS projects`);
    await queryRunner.query(`DROP TABLE IF EXISTS freelancer_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);

    // Enum types are dropped only if no remaining table depends on them.
    await queryRunner.query(`DROP TYPE IF EXISTS project_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_role`);

    // Extensions are intentionally left in place (may be shared).
  }
}
