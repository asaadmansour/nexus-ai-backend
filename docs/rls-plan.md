# Row-Level Security (RLS) Plan

Status: **Plan / decision document** — RLS is *not* yet enabled by a migration. This
document defines the intended policies so they can be applied deliberately.

## 1. Connection & trust model

The NestJS backend connects to Supabase/Postgres via `DATABASE_URL` using a
privileged role (the `postgres` / service role). **That role bypasses RLS.**

Two consequences:

1. All *business* authorization (who may read/write which project, etc.) is
   enforced in the **application layer** (NestJS guards/services), not by RLS.
2. RLS is therefore **defense-in-depth**: it only takes effect if a less-trusted
   path ever reaches the database directly — e.g. Supabase's auto-generated
   PostgREST/Realtime APIs using the `anon` or `authenticated` keys.

Because this schema stores its own `hashed_password` on `users`, the app owns
authentication; it does **not** rely on Supabase Auth (`auth.users`) today.

### Open decision (must be made before writing owner-based policies)

To express "a user may see their own row" we need `auth.uid()` (or a JWT claim)
to map to `users.id`. Pick one:

- **A. Backend-only access (recommended for now).** Never expose PostgREST/Realtime
  to clients. Enable RLS with a **default-deny** posture so that *if* an `anon`/
  `authenticated` key ever leaks or is enabled, it can read/write nothing. No
  owner policies needed. The backend keeps using the service role.
- **B. Direct client access via Supabase Auth.** Adopt Supabase Auth, keep
  `users.id` equal to `auth.users.id`, and write `auth.uid()`-based policies
  (section 4). Requires reconciling the local password model with Supabase Auth.

**Recommendation:** ship with **Option A** now; revisit B only if/when the
frontend talks to Supabase directly.

## 2. Baseline (apply to every table)

```sql
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE freelancer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects            ENABLE ROW LEVEL SECURITY;

-- Optional but stronger: also block the table owner from skipping RLS.
-- Do NOT FORCE on tables the service role must reach unless that role is
-- BYPASSRLS; the postgres/service role bypasses RLS regardless of FORCE.
```

With RLS enabled and **no policies**, every `anon`/`authenticated` query returns
zero rows and every write is rejected. That is the desired Option-A default-deny.

## 3. Roles

| Role            | Used by                          | RLS applies? |
| --------------- | -------------------------------- | ------------ |
| `postgres`      | migrations / admin               | bypassed     |
| service role    | NestJS backend (`DATABASE_URL`)  | bypassed     |
| `authenticated` | logged-in client (only Option B) | yes          |
| `anon`          | unauthenticated client           | yes          |

## 4. Intended policies (only if Option B is adopted)

Helper assumption: `auth.uid()` returns the current user's `users.id`, and a
helper to fetch the caller's role:

```sql
CREATE OR REPLACE FUNCTION current_user_role() RETURNS user_role
LANGUAGE sql STABLE AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$;
```

### users

```sql
-- Read own row; admins read all.
CREATE POLICY users_select_self ON users FOR SELECT
  USING (id = auth.uid() OR current_user_role() = 'admin');

-- Update own row only; never let a client change its own role.
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM users WHERE id = auth.uid()));

-- INSERT/DELETE stay backend-only (no policy => denied for anon/authenticated).
```

### freelancer_profiles

```sql
-- A freelancer reads/edits only their own profile; admins read all.
CREATE POLICY fp_select ON freelancer_profiles FOR SELECT
  USING (user_id = auth.uid() OR current_user_role() = 'admin');

CREATE POLICY fp_modify_self ON freelancer_profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Public discovery (if needed) should go through a curated VIEW or the backend,
-- not a blanket SELECT policy, to avoid leaking embeddings / interview scores.
```

### projects

```sql
-- Customer sees their own projects; admins see all.
CREATE POLICY projects_select_owner ON projects FOR SELECT
  USING (customer_id = auth.uid() OR current_user_role() = 'admin');

-- Customer may edit their own draft/in-progress projects.
CREATE POLICY projects_update_owner ON projects FOR UPDATE
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- Matching/assignment to freelancers, status transitions, and escrow-driven
-- money fields (held_amount/released_amount) remain backend-only.
```

## 5. Money / integrity fields stay server-side

`projects.held_amount` and `projects.released_amount` are caches whose source of
truth is `escrow_transactions`. No client policy should ever permit writing them;
they are mutated only by the backend (service role). Keep them outside any
`WITH CHECK` that a client write could satisfy.

## 6. Rollout checklist

1. Confirm the backend connects with a role that bypasses RLS (it does today).
2. Add a migration that runs the section-2 `ENABLE ROW LEVEL SECURITY` statements
   (default-deny / Option A).
3. Verify app behavior is unchanged (backend bypasses RLS).
4. Only if Option B is chosen later: add `current_user_role()` + the section-4
   policies in a follow-up migration and test with `anon`/`authenticated` JWTs.
