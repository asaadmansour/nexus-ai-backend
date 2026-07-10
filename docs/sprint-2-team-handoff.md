# Sprint 2 Team Handoff

This version uses the real backend route names that exist today, plus clearly
marks planned routes that still need to be built.

## Current Backend API Map

Global API prefix: `/api`

Already implemented:

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/users/me`
- `PATCH /api/users/me`

Current auth/profile payload field names are camelCase:

```json
{
  "firstName": "Asaad",
  "lastName": "Mansour",
  "email": "asaad@example.com",
  "password": "StrongPassword123!",
  "phoneNumber": "+201000000000",
  "role": "freelancer"
}
```

Current user response fields are also camelCase, for example:

- `firstName`
- `lastName`
- `phoneNumber`
- `photoUrl`
- `isEmailVerified`
- `isIdVerified`
- `role`

Important current gaps:

- No upload endpoints yet.
- No Supabase Storage integration yet.
- No email verification send/resend/confirm endpoint yet.
- No Google OAuth complete-profile backend yet.
- No freelancer profile controller/service yet.
- No projects controller/service yet, only the `projects` entity/module exists.
- No brief, brief messages, agent jobs, notifications, or project status history tables/entities yet.
- No freelancer assessment/exam tables, verification status workflow, or anti-cheat event tracking yet.
- No NestJS AI gateway/mock endpoints yet.
- No queue worker for AI agents yet.
- No production/staging deployment, domain, CI/CD pipeline, or release checklist yet.

## Sprint 2 Dependency Order

First step:

- Asaad makes the database clean and ready with Sprint 2 migrations/entities.

After Asaad's DB baseline is ready, work can split in parallel:

- Shahd can build auth/profile/upload/assessment screens against the agreed API contracts.
- Ebrahim can build projects, dashboards, requirements UI, and notifications placeholder.
- Muhanad can build normal product APIs and Supabase auth/storage/RLS work.
- Asaad can build AI gateway mock endpoints, assessment APIs, queue, and worker.
- Sameh can wire CI/CD, domains, envs, and deployment around stable scripts/env names.

Rule:

- If a feature is blocked by a backend route that is not done yet, frontend should build against the route contract in this document and use local mock data until the route lands.

## Shahd: Frontend Auth, Profile, Uploads

### Responsibility

Make auth/profile feel complete and connect only to the real backend routes where
they already exist.

### 1. Signup and login

Use the real backend routes:

- Signup: `POST /api/auth/signup`
- Login: `POST /api/auth/login`
- Refresh token: `POST /api/auth/refresh`
- Logout: `POST /api/auth/logout`
- Current user: `GET /api/users/me`
- Update current user: `PATCH /api/users/me`

Signup payload:

```json
{
  "firstName": "Shahd",
  "lastName": "Example",
  "email": "shahd@example.com",
  "password": "StrongPassword123!",
  "phoneNumber": "+201000000000",
  "role": "customer"
}
```

Login payload:

```json
{
  "email": "shahd@example.com",
  "password": "StrongPassword123!"
}
```

Update profile payload currently supports only:

```json
{
  "firstName": "Shahd",
  "lastName": "Example",
  "phoneNumber": "+201000000000"
}
```

### 2. Email verification UI

Build pages/states:

- `/register/success`
- `/verify-email`
- `/email-not-verified`

UI states:

- After signup: "Check your email to verify your account."
- If user logs in but email is not verified: "Please verify your email before continuing."
- Button: "Resend verification email"

Use this real field from `GET /api/users/me`:

- `user.isEmailVerified`

Backend gap:

- `POST /api/auth/resend-verification` does not exist yet.
- Email verification confirmation does not exist yet.

For Sprint 2 UI, Shahd can build the screen and wire the resend button once the
backend route lands.

### 3. Google OAuth button

Add Google OAuth button to:

- `/login`
- `/register`

Button text:

- "Continue with Google"

Backend gap:

- Google OAuth complete-profile flow does not exist yet in this NestJS backend.
- Planned backend route: `POST /api/auth/complete-profile`

After OAuth success, frontend should eventually call:

- `GET /api/users/me`

If the user has no platform profile yet, redirect to:

- `/complete-profile`

### 4. Complete profile page

Route:

- `/complete-profile`

Fields:

- First name
- Last name
- Phone number
- Role: Customer / Freelancer

Planned backend route:

- `POST /api/auth/complete-profile`

Use camelCase payload names:

```json
{
  "firstName": "Asaad",
  "lastName": "Mansour",
  "phoneNumber": "+201000000000",
  "role": "freelancer"
}
```

If role is `freelancer`, redirect to:

- `/freelancer/onboarding`

### 5. Profile image upload UI

On profile page:

- Avatar preview
- Upload image button
- Remove image button optional
- Save profile button

Accepted types:

- `jpg`
- `jpeg`
- `png`
- `webp`

Max size:

- Prefer `2MB`
- Acceptable MVP fallback: `5MB`

Backend gap:

- No current profile image upload API.
- Planned route: `POST /api/uploads/profile-image`
- The DB field already exists as `photoUrl`.

### 6. Freelancer CV upload UI

On freelancer profile/onboarding page:

- Upload CV
- Show uploaded file name
- Replace CV
- View CV link

Accepted types:

- MVP: `pdf`
- Later: `doc`, `docx`

Backend gap:

- No current CV upload API.
- Planned route: `POST /api/uploads/freelancer-cv`
- The DB field already exists as `cvUrl` on `freelancer_profiles`.

### 7. Freelancer onboarding page

Route:

- `/freelancer/onboarding`

Fields:

- Headline
- Bio / summary
- Skills
- Years of experience
- Hourly rate
- Availability toggle
- CV upload
- Profile image upload

Backend gap:

- No current freelancer profile API.
- Planned route: `GET /api/freelancers/me`
- Planned route: `PATCH /api/freelancers/me`

After Asaad's DB migration, use the real freelancer profile columns:

- `headline`
- `bio`
- `skills`
- `yearsExperience`

Keep `summary` for AI-parsed extra CV/profile metadata.

### 8. Freelancer assessment UI

After signup, email verification, ID verification, profile completion, and CV
upload, freelancer users should move into an assessment flow before approval.

Recommended status flow:

- `profile_incomplete`
- `email_verification_pending`
- `id_verification_pending`
- `cv_pending`
- `assessment_pending`
- `assessment_in_progress`
- `assessment_submitted`
- `interview_pending`
- `approved`
- `rejected`

Build pages/states:

- `/freelancer/verification`
- `/freelancer/assessment`
- `/freelancer/assessment/result`

Assessment UI:

- Shows assessment status.
- Starts generated exam when available.
- Runs in fullscreen mode.
- Shows strict timer.
- Warns on tab switch/focus loss.
- Tracks copy/paste attempts where possible.
- Submits answers automatically when time expires.
- Shows pending review state after submission.

Question types for Sprint 2:

- Multiple choice
- Short answer
- Practical scenario question

Important product rule:

- Approval should be based on CV, generated assessment answers, anti-cheat event review, and admin review.

Planned backend routes:

- `GET /api/freelancer-verification/me`
- `POST /api/freelancer-assessments/start`
- `GET /api/freelancer-assessments/current`
- `POST /api/freelancer-assessments/:id/answers`
- `POST /api/freelancer-assessments/:id/submit`
- `POST /api/freelancer-assessments/:id/events`

### 9. Frontend validation

Add validation for:

- Required fields
- Invalid email
- Password mismatch
- Invalid file type
- File too large
- Invalid hourly rate
- Assessment timer expired
- Assessment already submitted
- Fullscreen/focus warnings

### Shahd Definition of Done

- Signup and login use the real routes: `/api/auth/signup` and `/api/auth/login`.
- Profile page reads real data from `GET /api/users/me`.
- Profile edit saves real data through `PATCH /api/users/me`.
- Email verification screens exist and read `isEmailVerified`.
- Google OAuth button exists.
- OAuth callback can redirect to `/complete-profile`.
- Complete profile page exists.
- Profile image upload UI exists, even if backend upload is still pending.
- CV upload UI exists, even if backend upload is still pending.
- Freelancer onboarding page exists.
- Freelancer verification/assessment pages exist.
- Timed assessment UI supports fullscreen, warnings, answer save, and final submit.
- Upload errors are shown clearly.

## Ebrahim: Frontend Projects, Dashboards, Requirements UI

### Responsibility

Make the customer project flow real once backend project APIs land. Until then,
build against the planned route names below.

### 1. Customer create project page

Route:

- `/customer/projects/new`

Fields:

- Project title
- Short description
- Budget minimum
- Budget maximum
- Currency
- Deadline date
- Deadline flexible toggle

Planned backend route:

- `POST /api/projects`

Expected payload names should follow the backend entity style:

```json
{
  "title": "E-commerce Website",
  "description": "Short project description",
  "budgetMin": 10000,
  "budgetMax": 25000,
  "currency": "EGP",
  "deadline": "2026-08-01",
  "isDeadlineFlexible": true
}
```

Current backend gap:

- `POST /api/projects` does not exist yet.
- The current `projects` entity has `title`, `budgetMin`, `budgetMax`, `currency`, and `status`.
- It does not yet have `description`, `deadline`, or `isDeadlineFlexible`.

After success:

- Redirect to `/customer/projects/:id`

### 2. Customer projects list

Route:

- `/customer/projects`

Planned backend route:

- `GET /api/projects`

Show:

- Project title
- Status
- Budget range
- Deadline, once backend supports it
- Created date
- Action: View

Empty state:

- "No projects yet."
- Button: "Create your first project."

### 3. Project details page

Route:

- `/customer/projects/:id`

Planned backend route:

- `GET /api/projects/:id`

Sections:

- Project overview
- Status
- Budget
- Deadline, once backend supports it
- Brief status
- Recent activity
- Next action

If no brief exists:

- Next action: Start requirements

### 4. Requirements agent mock chat page

Route:

- `/customer/projects/:id/requirements`

Planned backend routes:

- `POST /api/projects/:id/brief/messages`
- `GET /api/projects/:id/brief`
- `GET /api/projects/:id/brief/messages`

UI:

- Chat panel
- Live brief summary panel
- Missing fields checklist
- Completion percentage

Mock behavior:

- User sends answer.
- Message appears.
- Backend creates/saves a brief message.
- Backend queues or mocks an agent response.
- Agent reply appears.
- Brief summary updates partially.

Current backend gap:

- No brief tables or routes yet.
- No agent job table or queue worker yet.

### 5. Dashboard real data

Customer dashboard:

- Active projects count from API
- Draft projects count
- Recent projects

Freelancer dashboard:

- Profile readiness from freelancer profile API
- CV uploaded yes/no
- Hourly rate set yes/no
- Availability

Admin dashboard:

- Total users
- Total projects
- Recent registrations

Current backend gap:

- No admin stats API yet.
- Planned admin routes are listed under backend tasks.

### 6. Notifications UI placeholder

Create notification dropdown using local/static data for Sprint 2 unless the
notifications API lands early.

Planned backend route later:

- `GET /api/notifications`

### Ebrahim Definition of Done

- Customer can create project UI.
- Customer can view project list UI.
- Customer can open project details UI.
- Customer can start requirements mock flow UI.
- Customer dashboard is ready to connect to real API.
- Freelancer dashboard is ready to connect to real profile API.
- Admin dashboard is ready to connect to stats API.
- Frontend pages are no longer hard-coded to old fake endpoint names.

## Muhanad + Asaad: Core NestJS APIs

### Responsibility

Build the missing NestJS APIs that Shahd and Ebrahim need, using the route names
above and the current backend conventions.

Ownership split:

- Muhanad owns normal product APIs: auth completion, email verification, uploads, freelancer profile, projects, and admin CRUD/stats.
- Asaad owns AI-connected APIs: NestJS AI gateway/mock endpoints, freelancer assessment endpoints, agent job creation, and anything that hands work to the AI worker/queue.
- Shahd and Ebrahim are responsible for frontend integration/testing against these APIs, not backend implementation.
- Sameh is responsible for CI/CD/deployment around these APIs, not feature implementation.

### 1. Auth completion

Owner: Muhanad

Current real routes:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/users/me`
- `PATCH /api/users/me`

Routes to add:

- `POST /api/auth/complete-profile`
- `POST /api/auth/resend-verification`

`complete-profile` payload:

```json
{
  "firstName": "Asaad",
  "lastName": "Mansour",
  "phoneNumber": "+201000000000",
  "role": "freelancer"
}
```

Behavior:

- Create `users` row for OAuth users.
- If role is `freelancer`, create `freelancer_profiles` row.
- Return the same user shape as `GET /api/users/me`.

### 2. Email verification backend logic

Owner: Muhanad

Decide source of truth:

- Supabase Auth `email_confirmed_at`, or
- local `users.is_email_verified`

Backend should expose camelCase:

```json
{
  "isEmailVerified": true
}
```

### 3. Storage upload endpoints

Owner: Muhanad

Routes to add:

- `POST /api/uploads/profile-image`
- `POST /api/uploads/freelancer-cv`

Behavior:

- Require auth.
- Validate file type.
- Validate file size.
- Upload to Supabase Storage.
- Save final URL/path to DB.

Storage destinations:

- `profile-images/{userId}/avatar.webp`
- `freelancer-cvs/{userId}/cv.pdf`

DB fields:

- User photo: `users.photo_url`, exposed as `photoUrl`
- Freelancer CV: `freelancer_profiles.cv_url`, exposed as `cvUrl`

### 4. Freelancer profile APIs

Owner: Muhanad

Routes to add:

- `GET /api/freelancers/me`
- `PATCH /api/freelancers/me`

Patch payload:

```json
{
  "headline": "Full Stack Developer",
  "bio": "I build web apps.",
  "skills": ["NestJS", "React"],
  "yearsExperience": 3,
  "hourlyRate": 25,
  "isAvailable": true
}
```

Keep `summary` for AI-parsed extra CV/profile metadata, not the primary editable profile fields.

### 5. Project APIs

Owner: Muhanad

Routes to add:

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`

Rules:

- Customer can create projects.
- Customer can only see own projects.
- Admin can see all projects.
- Freelancer should not see customer projects yet unless assigned later.

Current entity fields:

- `title`
- `budgetMin`
- `budgetMax`
- `currency`
- `status`

Fields to add if Sprint 2 needs them:

- `description`
- `deadline`
- `isDeadlineFlexible`

### 6. Freelancer verification and assessment APIs

Owner: Asaad

Routes to add:

- `GET /api/freelancer-verification/me`
- `PATCH /api/admin/freelancer-verifications/:userId`
- `POST /api/freelancer-assessments/start`
- `GET /api/freelancer-assessments/current`
- `POST /api/freelancer-assessments/:id/answers`
- `POST /api/freelancer-assessments/:id/submit`
- `POST /api/freelancer-assessments/:id/events`

Rules:

- Only freelancer users can start their own assessment.
- Assessment can start only after email verification, ID verification, profile completion, and CV upload.
- Assessment questions are generated from the CV/profile skills by an AI job.
- Frontend must never receive correct answers or private rubrics.
- Timer is enforced by backend using `startedAt`, `expiresAt`, and `submittedAt`.
- Anti-cheat events are stored for review; they should not auto-reject by themselves in Sprint 2.
- Admin can approve, reject, or move freelancer to `interview_pending`.

Recommended verification statuses:

- `profile_incomplete`
- `email_verification_pending`
- `id_verification_pending`
- `cv_pending`
- `assessment_pending`
- `assessment_in_progress`
- `assessment_submitted`
- `interview_pending`
- `approved`
- `rejected`

### 7. NestJS AI gateway and mock endpoints

Owner: Asaad

Routes to add:

- `POST /api/ai/validate-brief`
- `POST /api/ai/extract-cv`
- `POST /api/ai/generate-assessment`
- `POST /api/ai/grade-assessment`

Rules:

- These endpoints must exist in Sprint 2 even if they return mock data.
- Use a single NestJS AI client/service wrapper behind these routes.
- If `AI_SERVICE_URL` is missing or `AI_MOCK_MODE=true`, return deterministic mock data.
- If `AI_SERVICE_URL` is configured and mock mode is off, call the real AI/FastAPI service.
- Keep request/response shapes stable so frontend/backend work can continue before real AI quality is ready.
- Protect endpoints with auth/admin or keep them internal-only; normal users should use product routes, not raw AI routes.
- Product flows can call the same AI service wrapper directly or enqueue an `agent_jobs` job.

Expected mock outputs:

- `validate-brief`: returns missing fields, completion percentage, and a suggested agent reply.
- `extract-cv`: returns extracted skills, experience summary, and project claims.
- `generate-assessment`: returns candidate-safe questions only, never rubrics/correct answers.
- `grade-assessment`: returns score, feedback, and recommendation: `pass`, `needs_review`, or `fail`.

### 8. Admin APIs

Owner: Muhanad, with Asaad supporting assessment review data.

Routes to add:

- `GET /api/admin/users`
- `GET /api/admin/projects`
- `GET /api/admin/stats`
- `GET /api/admin/freelancer-verifications`
- `GET /api/admin/freelancer-assessments/:id`

Rules:

- Protected by `AuthGuard`.
- Protected by `RolesGuard`.
- Requires `role = admin`.

### Core Backend Definition of Done

- OAuth users can complete profile.
- `GET /api/users/me` returns role, `isEmailVerified`, `isIdVerified`, and profile fields.
- Profile image upload works.
- CV upload works.
- Freelancer profile get/update works.
- Freelancer verification status is exposed.
- Timed AI-generated assessment can be started, answered, submitted, and reviewed.
- NestJS AI gateway endpoints exist and can return mock data.
- Customer project create/list/details works.
- Admin protected endpoints exist.
- Backend passes the CI commands agreed with Sameh.

## Asaad: AI Agent Worker, Queue, and Agent Jobs

### Responsibility

Asaad owns the NestJS AI gateway, mock AI responses, and the worker/queue layer
for AI agents. This is separate from the regular frontend pages and normal CRUD
APIs.

### 1. NestJS AI gateway and mock mode

Create a NestJS AI module/client before real model quality is ready.

Planned files:

- `src/ai/ai.module.ts`
- `src/ai/ai.controller.ts`
- `src/ai/ai.service.ts`
- `src/ai/ai-client.service.ts`
- `src/ai/mock-ai.service.ts`

Planned env vars:

- `AI_SERVICE_URL`
- `AI_SERVICE_TIMEOUT_MS`
- `AI_MOCK_MODE`

Required behavior:

- Nest endpoints return useful mock JSON when `AI_MOCK_MODE=true`.
- Mock responses must be deterministic enough for frontend/backend testing.
- The same service wrapper should be usable by product APIs and workers.
- Real FastAPI calls can be swapped in without changing product route contracts.
- Mock mode should support `validate-brief`, `extract-cv`, `generate-assessment`, and `grade-assessment`.

### 2. Queue architecture

Create a queue system for AI jobs.

Recommended:

- BullMQ
- Redis
- A separate NestJS worker entrypoint

Planned queue name:

- `ai-agents`

Planned job types:

- `validate_brief`
- `extract_cv`
- `summarize_cv`
- `generate_freelancer_assessment`
- `grade_freelancer_assessment`
- `match_freelancers`

### 3. Agent jobs table

Add an `agent_jobs` table/entity.

Recommended fields:

- `id`
- `jobType`
- `status`
- `projectId`
- `userId`
- `payload`
- `result`
- `error`
- `attempts`
- `createdAt`
- `updatedAt`
- `startedAt`
- `completedAt`

Recommended statuses:

- `queued`
- `processing`
- `completed`
- `failed`

### 4. Brief/requirements mock agent

Planned backend routes:

- `POST /api/projects/:id/brief/messages`
- `GET /api/projects/:id/brief`
- `GET /api/projects/:id/brief/messages`

When customer sends a message:

- Save customer message in `brief_messages`.
- Create `agent_jobs` row with `jobType = validate_brief`.
- Push job to `ai-agents` queue.
- Worker calls FastAPI mock agent or local mock service.
- Save agent reply in `brief_messages`.
- Update brief partial data.
- Mark `agent_jobs.status = completed` or `failed`.

Sprint 2 acceptable fallback:

- If BullMQ is not ready, keep the same `agent_jobs` table and call the mock agent directly from NestJS, but keep the interface queue-ready.

### 5. Freelancer assessment AI jobs

Add AI jobs for freelancer verification:

- `extract_cv`: parse uploaded CV into skills, experience, and project claims.
- `generate_freelancer_assessment`: create a timed exam from CV/profile skills.
- `grade_freelancer_assessment`: grade submitted answers and produce structured feedback.

Assessment generation rules:

- Generate questions from claimed skills, not random generic trivia.
- Include a mix of multiple choice, short answer, and practical scenario questions.
- Store correct answers/rubrics server-side only.
- Return only candidate-safe question data to the frontend.
- Produce an admin-readable explanation of why each answer scored well or poorly.

Assessment grading rules:

- AI can recommend `pass`, `needs_review`, or `fail`.
- AI must not directly approve or reject the freelancer.
- Human/admin review remains the final decision for Sprint 2.

### 6. Worker process

Add a separate worker entrypoint and script.

Planned files:

- `src/worker.ts`
- `src/agents/agents.module.ts`
- `src/agents/agent-jobs.entity.ts`
- `src/agents/agent-queue.service.ts`
- `src/agents/agent-worker.processor.ts`

Planned scripts:

- `npm run start:worker`
- `npm run start:worker:dev`

### 7. FastAPI AI service integration

Worker should call the AI service through a single client/service wrapper.

Planned environment variables:

- `AI_SERVICE_URL`
- `AI_SERVICE_TIMEOUT_MS`
- `AI_MOCK_MODE`

Initial mock endpoints can be:

- `POST {AI_SERVICE_URL}/validate-brief`
- `POST {AI_SERVICE_URL}/extract-cv`
- `POST {AI_SERVICE_URL}/generate-assessment`
- `POST {AI_SERVICE_URL}/grade-assessment`

Until the real service is ready:

- NestJS should return mock data through the same AI client contract.
- Worker jobs should still complete successfully in mock mode.

### 8. Observability and retries

Add:

- Retry count
- Last error
- Job timestamps
- Logs for job start, success, and failure
- Safe timeout for AI service calls

### Asaad Definition of Done

- `agent_jobs` entity/table exists.
- Queue name `ai-agents` is defined.
- NestJS AI gateway endpoints exist.
- `AI_MOCK_MODE` can make AI routes and worker jobs return mock data.
- Worker can process `validate_brief` jobs.
- Worker can process `extract_cv`, `generate_freelancer_assessment`, and `grade_freelancer_assessment` jobs.
- Brief message flow can create an agent job.
- Freelancer assessment flow can create agent jobs.
- Worker saves mock agent response.
- Failed jobs are marked failed with an error.
- AI service URL is configurable from env.
- The normal API can continue working even if the worker is down.
- Sameh has the worker start command, env vars, and health/restart notes needed for deployment.

## Sameh: DevOps, Deployment, CI/CD, Domains

### Responsibility

Make the project deployable and keep the team from shipping broken builds.
Sameh owns the deployment pipeline and release checklist, but each feature owner
is still responsible for keeping their own area buildable.

### 1. Environments

Create clear environment targets:

- Local development
- Staging
- Production

Define environment variable ownership:

- Backend runtime env: backend owner + Sameh
- Supabase URLs/keys/storage names: Muhanad + Sameh
- AI service and worker env: Asaad + Sameh
- Frontend API base URLs/callback URLs: Shahd/Ebrahim + Sameh

Minimum backend env checklist:

- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `REDIS_HOST`
- `REDIS_PORT`
- `AI_SERVICE_URL`
- `AI_SERVICE_TIMEOUT_MS`
- Supabase project URL/key variables once storage/auth integration lands

### 2. CI pipeline

Add CI for every pull request.

Backend checks:

- Install dependencies with lockfile.
- Run formatting/lint check.
- Run TypeScript build: `npm run build`
- Run tests: `npm test`, once tests are stable enough for CI.
- Fail the PR if build or tests fail.

Important script cleanup:

- Current `npm run lint` uses `eslint --fix`, which mutates files.
- Add a non-mutating CI lint script such as `lint:check`.
- Keep `lint` for local auto-fix if the team wants it.

Recommended backend scripts:

```json
{
  "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
  "lint:check": "eslint \"{src,apps,libs,test}/**/*.ts\"",
  "ci": "npm run lint:check && npm run build && npm test"
}
```

Frontend checks, owned by frontend team with Sameh wiring CI:

- Install dependencies with lockfile.
- Run lint.
- Run build.
- Run basic smoke tests if available.

### 3. CD and deployment

Set up deployment for:

- Backend API
- Frontend app
- AI worker process
- Optional FastAPI AI service, if it is separate from the NestJS backend

Deployment requirements:

- Staging deploy on merge to the main integration branch.
- Production deploy should be manual approval for Sprint 2.
- Backend deploy must run only after CI passes.
- Worker deploy must restart safely and not block the API deploy.
- Migrations must be run deliberately, not hidden inside random app startup.

### 4. Domains and URLs

Choose final names later, but reserve this structure:

- Frontend: `https://app.your-domain.com`
- Backend API: `https://api.your-domain.com`
- AI service, if exposed internally only: private URL preferred
- Supabase callback URL: `https://app.your-domain.com/auth/callback`

Sprint 2 tasks:

- Buy/connect domain or configure existing domain.
- Add DNS records.
- Enable HTTPS.
- Configure CORS for frontend domain.
- Configure Supabase OAuth redirect URLs for localhost, staging, and production.
- Confirm frontend uses the correct API base URL per environment.

### 5. Runtime health and logs

Backend already has:

- `GET /api/health`

Add or document:

- API health check URL.
- Worker health/restart process.
- Redis connectivity check.
- Database connectivity check.
- Log location/provider.
- How to inspect failed deploys.

### 6. Release checklist

Create a short release checklist:

- CI green.
- DB migrations reviewed.
- Env vars present in target environment.
- Supabase buckets/policies ready.
- OAuth callback URLs configured.
- Backend `/api/health` returns OK.
- Frontend can login/signup against deployed API.
- Worker is running or explicitly disabled.
- Rollback path is known.

### Sameh Definition of Done

- CI runs on PRs and blocks broken builds.
- Non-mutating lint check exists for CI.
- Staging deploy exists for backend and frontend.
- Production deployment path is documented.
- Domain/DNS/HTTPS plan is documented or configured.
- CORS and frontend API base URLs are correct for staging.
- Deployment secrets/env vars are documented without exposing secret values.
- Release checklist exists.
- Backend API health check is monitored or easy to verify.
- Worker deployment requirements from Asaad are captured.

## Shared DevOps Split

To keep Sameh's part reasonable:

- Backend owner: keeps `npm run build`, `lint:check`, tests, env validation, and `/api/health` working.
- Shahd and Ebrahim: keep frontend lint/build green and provide smoke-test paths for auth, profile, projects, and dashboards.
- Asaad: owns the clean Sprint 2 DB schema/migrations first, then worker start commands, queue names, env vars, and failure/retry behavior.
- Muhanad: owns Supabase project config, auth config, storage buckets, storage policies, RLS policies, and OAuth callback setup.
- Sameh: wires CI/CD, domains, deployment secrets, release checklist, and environment coordination.

## Asaad: Database Clean State and Sprint 2 Migrations

### Responsibility

Before the team starts building against the new Sprint 2 flows, Asaad owns making
the database schema clean and ready. This is the first backend step for the
sprint.

### 1. Migration approach

Create migrations for the Sprint 2 schema in a clean, reviewable way.

Rules:

- Do not rely on TypeORM `synchronize`.
- Keep migrations idempotent where possible.
- Keep old data safe unless the team explicitly agrees to reset local/staging DB.
- Run migrations locally before telling the team the API contract is ready.
- Make sure entities and migrations match.
- Share the final table/column list with Muhanad so RLS policies can match the real schema.

### 2. Add/confirm DB tables

Already exists:

- `users`
- `freelancer_profiles`
- `projects`
- `refresh_tokens`

Needed for Sprint 2:

- `project_status_history`
- `briefs`
- `brief_messages`
- `agent_jobs`
- `freelancer_assessments`
- `freelancer_assessment_questions`
- `freelancer_assessment_answers`
- `freelancer_assessment_events`
- `notifications`

### 3. Add project columns

Recommended migration:

```sql
alter table projects
add column if not exists description text,
add column if not exists deadline timestamptz,
add column if not exists is_deadline_flexible boolean not null default false;
```

Why:

- Ebrahim's create/list/detail project UI needs description and deadline fields.
- The frontend payload uses `isDeadlineFlexible`, exposed from `is_deadline_flexible`.

### 4. Add supporting workflow tables

Recommended supporting tables:

```sql
create table project_status_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  old_status varchar(40),
  new_status varchar(40) not null,
  changed_by uuid references users(id),
  changed_by_type varchar(30),
  reason text,
  created_at timestamptz not null default now()
);

create table briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  is_complete boolean not null default false,
  completed_at timestamptz,
  raw_conversation jsonb,
  client_background varchar(40),
  ai_decides_stack boolean not null default false,
  summary text,
  project_type varchar(100),
  domain varchar(100),
  technical jsonb,
  non_functional jsonb,
  deliverables jsonb,
  suggested_team_size int,
  preferred_timeline interval,
  is_deadline_flexible boolean not null default false,
  deadline_date date,
  required_skills text,
  preferred_skills text,
  experience_level varchar(20),
  experience_min_years int,
  ai_decided jsonb,
  acceptance_criteria jsonb,
  brief_text text,
  embedding text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table brief_messages (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references briefs(id) on delete cascade,
  sender_type varchar(30) not null,
  message text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table agent_jobs (
  id uuid primary key default gen_random_uuid(),
  agent_name varchar(50),
  job_type varchar(50) not null,
  project_id uuid references projects(id),
  task_id uuid,
  brief_id uuid references briefs(id),
  submission_id uuid,
  matching_run_id uuid,
  status varchar(40) not null default 'queued',
  queue_name varchar(100),
  queue_job_id varchar(255),
  input jsonb,
  output jsonb,
  error text,
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid references projects(id),
  task_id uuid,
  title varchar(255) not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
```

Why:

- Project APIs can create status history immediately.
- Requirements chat can save brief state and messages.
- AI gateway/worker can create jobs before real AI quality is ready.
- Notifications UI can start with real persisted data later without changing the route.

### 5. Add helpful freelancer columns

Recommended migration:

```sql
alter table freelancer_profiles
add column if not exists headline text,
add column if not exists bio text,
add column if not exists skills text[],
add column if not exists years_experience int,
add column if not exists verification_status text not null default 'profile_incomplete',
add column if not exists assessment_score numeric(5,2),
add column if not exists assessment_submitted_at timestamptz,
add column if not exists approved_at timestamptz,
add column if not exists rejected_at timestamptz,
add column if not exists rejection_reason text;
```

Also add a check constraint for `years_experience >= 0` if the migration does
not already have one.

Why:

- Matching will need skills as a real queryable column later.
- Verification needs a status workflow beyond only `is_id_verified` and `interview_score`.

### 6. Add freelancer assessment tables

Recommended assessment tables:

```sql
create table freelancer_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  freelancer_profile_id uuid not null references freelancer_profiles(id) on delete cascade,
  status text not null default 'pending',
  duration_seconds int not null,
  started_at timestamptz,
  expires_at timestamptz,
  submitted_at timestamptz,
  score numeric(5,2),
  ai_feedback jsonb,
  generated_from_cv_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table freelancer_assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references freelancer_assessments(id) on delete cascade,
  question_type text not null,
  skill text,
  difficulty text,
  prompt text not null,
  choices jsonb,
  rubric jsonb,
  order_index int not null,
  created_at timestamptz not null default now()
);

create table freelancer_assessment_answers (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references freelancer_assessments(id) on delete cascade,
  question_id uuid not null references freelancer_assessment_questions(id) on delete cascade,
  answer jsonb not null,
  score numeric(5,2),
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table freelancer_assessment_events (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references freelancer_assessments(id) on delete cascade,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
```

Important:

- Do not expose `rubric`, correct answers, or private scoring data to the frontend.
- Use backend timestamps for assessment timers.
- Assessment events are review signals, not automatic rejection.

### 7. Seed data

Create test accounts:

- 1 customer
- 1 freelancer
- 1 admin

Create optional sample project:

- Project title: `E-commerce Website`
- Status: `draft`

### Asaad DB Definition of Done

- Sprint 2 migrations exist.
- Entities match the migrated schema.
- Local DB can migrate from clean state.
- Team has baseline seed/test data.
- Muhanad has the final schema for RLS/storage policy work.
- Backend build still passes after entity changes.

## Muhanad: Supabase Auth, Storage, RLS

### Responsibility

Make Supabase real: auth config, storage buckets, storage policies, and RLS
policies based on Asaad's finalized migrations.

### 1. Supabase Auth config

Configure:

- Email/password auth
- Email confirmation
- Google OAuth provider
- Redirect URLs

Redirect URLs:

- `http://localhost:3000/auth/callback`
- Staging callback URL from Sameh's staging domain
- Production callback URL from Sameh's production domain

### 2. Storage buckets

Create buckets:

- `profile-images`
- `freelancer-cvs`
- `project-files`
- `submission-files`

Sprint 2 active buckets:

- `profile-images`
- `freelancer-cvs`

Bucket access:

- `profile-images`: public read or signed read, user uploads own image.
- `freelancer-cvs`: private, freelancer uploads own CV, admin/service role can read.

### 3. RLS policies

RLS should be written after Asaad finalizes the Sprint 2 migrations, so policies
match the real table and column names.

Minimum policies:

- `users`: user can select own row, user can update own profile fields, admin can select all.
- `freelancer_profiles`: freelancer can select/update own profile, admin can select all.
- `projects`: customer can select/insert/update own projects, admin can select all.
- `briefs`: customer can select own project brief, admin can select all.
- `brief_messages`: customer can select/insert messages for own project brief, admin can select all.
- `freelancer_assessments`: freelancer can select own assessment, admin can select all.
- `freelancer_assessment_questions`: freelancer can select candidate-safe questions for own assessment; rubrics/correct answers must stay backend-only.
- `freelancer_assessment_answers`: freelancer can insert/update own answers before submission, admin can select all.
- `freelancer_assessment_events`: freelancer can insert own events, admin can select all.

See `docs/rls-plan.md` for the current RLS plan.

### 4. Storage policies

Profile images:

- User can upload to folder matching own user ID.
- User can update own image.
- Authenticated users can view profile image.

CVs:

- Freelancer can upload own CV.
- Freelancer can view own CV.
- Admin can view all CVs.
- Service role can access for AI later.

### Muhanad Definition of Done

- Supabase Auth email/password works.
- Google OAuth is configured.
- Storage buckets exist.
- Storage policies are applied.
- RLS plan is implemented or explicitly deferred after Asaad finalizes migrations.
