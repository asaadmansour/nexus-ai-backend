# Row-Level Security (RLS) Plan

Scope: `users`, `freelancer_profiles`, `projects` (initial schema). This is a
plan/checklist — the policies are **not** applied by the current migration.

## Key architectural decision first

Decide **who talks to the database**:

- **Backend-only access (recommended for this NestJS app).** The API connects
  with the Supabase Postgres role (`postgres` / service role via the pooler in
  `DATABASE_URL`). This role **bypasses RLS**. In this model, RLS is a
  *defense-in-depth backstop*, and all real authorization lives in NestJS
  guards/services. Enable RLS with restrictive/no policies so that a leaked
  anon/authenticated key cannot read the tables directly.
- **Direct client access (Supabase JS from the frontend).** If the browser ever
  queries these tables directly using the `anon`/`authenticated` keys, RLS is
  the *primary* authorization layer and the policies below must be complete and
  correct before launch.

Because the backend uses the service role, **write the policies below anyway** —
they cost nothing when unused and protect against accidental key exposure.

## Enabling RLS

For every table, enable and force RLS:

```sql
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE freelancer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects            ENABLE ROW LEVEL SECURITY;
```

> With RLS enabled and **no** policies, the table is deny-all for non-superusers
> and non-owners. The `postgres`/service role still bypasses it.

Helper: Supabase exposes the authenticated user id via `auth.uid()` (a `uuid`).
These policies assume `users.id` equals the Supabase Auth user id. If you keep a
separate identity table, adjust the join accordingly.

## Proposed policies

### `users`
- **Select own row:** a user may read their own record.
  ```sql
  CREATE POLICY users_select_self ON users
    FOR SELECT USING (id = auth.uid());
  ```
- **Update own row (non-privileged columns):** allow self-update; block role
  escalation and verification flags at the app layer or with a `WITH CHECK`
  that pins `role`.
  ```sql
  CREATE POLICY users_update_self ON users
    FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  ```
- **Admins:** full access via a claim check, e.g.
  `USING ((auth.jwt() ->> 'role') = 'admin')`.
- **Insert:** typically only through the backend (signup flow) — no client
  insert policy.

### `freelancer_profiles`
- **Owner read/write:** the owning user (`user_id = auth.uid()`).
  ```sql
  CREATE POLICY fp_owner_all ON freelancer_profiles
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  ```
- **Public/limited read for matching:** customers need to discover freelancers.
  Prefer exposing a **view** with only public columns (no `embedding`,
  no `cv_url`, no internal scores) rather than a broad SELECT policy on the base
  table. If a base-table policy is needed:
  ```sql
  CREATE POLICY fp_public_read ON freelancer_profiles
    FOR SELECT USING (is_available = true AND deleted_at IS NULL);
  ```
- **Admins:** full access via claim check.

### `projects`
- **Customer owns their projects:**
  ```sql
  CREATE POLICY projects_owner_all ON projects
    FOR ALL USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
  ```
- **Assigned freelancer read:** once assignment tables exist, add a policy that
  lets an assigned freelancer read the project (join through the future
  `assignments` table). Deferred until those tables are migrated.
- **Admins:** full access via claim check.

## Cross-cutting rules
- **Soft deletes:** every client-facing SELECT policy should include
  `deleted_at IS NULL`.
- **Money columns:** `held_amount` / `released_amount` on `projects` are caches;
  never writable by clients — enforce at the backend and omit from any client
  UPDATE policy.
- **Sensitive columns:** `hashed_password`, `embedding`, `cv_url`,
  `interview_score` must never be exposed to `anon`/`authenticated`. Use views
  or column privileges in addition to RLS.
- **Service role:** confirm the backend truly uses a role that bypasses RLS; if
  you switch the backend to the `authenticated` role, every backend query must
  satisfy these policies.

## Rollout steps
1. Ship tables (this migration) first, with RLS **disabled**, so the backend
   works end-to-end.
2. Add a follow-up migration that `ENABLE ROW LEVEL SECURITY` + creates the
   policies above.
3. Test with a non-service (anon/authenticated) JWT against each table to prove
   deny-by-default and each policy path.
4. Revisit `projects` freelancer-read + `freelancer_profiles` discovery once the
   assignment/matching tables are added.
