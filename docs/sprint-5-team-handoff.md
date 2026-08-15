# Sprint 5 Team Handoff

Sprint 5 turns the planned project into real delivery work.

Sprint 4 ended with this flow:

1. Customer completes requirements.
2. Requirements agent creates the final project quote.
3. Customer funds escrow.
4. Payment success starts planning-role matching.
5. Admin chooses architect, then UI/UX.
6. Architect and UI/UX submit planning deliverables.
7. Admin approves both deliverables.
8. Scrum Master generates the implementation plan.
9. Admin approves and materializes the plan into milestones, tasks, dependencies, and the locked project spec.

Sprint 5 starts after step 9.

The goal is:

- Match implementation tasks to approved freelancers.
- Let freelancers submit real work.
- Evaluate submissions with an AI evaluation agent.
- Let customer/admin request revisions on specific tasks or milestones.
- Create and manage a GitHub repository owned by Nexus.
- Invite assigned freelancers as repo collaborators.
- Release escrow by milestone or approved submission.
- Keep every product decision in the database as source of truth.

This file is the contract for backend, frontend, and AI service. Do not invent alternate route names or payload shapes. If a route or field needs to change, update this file first.

## What Is Missing Right Now

The database foundation is mostly present in
`1785200000000-AddExecutionReadinessTables.ts`, which added:

- `project_repositories`
- `repository_collaborators`
- `project_submissions`
- `project_submission_reviews`
- `project_revision_requests`
- `evaluation_runs`
- `payment_release_requests`
- `project_milestones`
- `project_tasks`
- `project_task_dependencies`
- `matching_runs.target_task_id`

Important missing pieces before Sprint 5 is complete:

- The previous Supabase project reference no longer exists. Local PostgreSQL 17
  with pgvector is working and fully migrated, but a new shared hosted database
  must be provisioned before staging/team integration.
- Sprint 5 migrations `1785500000000-Sprint5Readiness.ts` and
  `1785600000000-AddSprint5DeliveryContract.ts` are verified locally and must
  be repeated on the replacement hosted database.
- Customer/freelancer delivery, submission, revision, and release-request pages
  and their typed frontend services still need to be implemented.

## Readiness Audit

Audit date: 2026-08-15.

Verdict: **Sprint 5 is ready for local implementation.** It is not ready for a
shared staging deployment until the expired Supabase project is replaced and
the verified migrations are applied there.

What is ready:

- NestJS production build passes.
- All 7 Jest suites pass (19 tests).
- Sprint 5 readiness migration, entity mappings, profile update persistence,
  and GitHub username validation are implemented locally.
- PostgreSQL 17 with pgvector is running locally and all 22 migrations are
  applied; post-migration inspection confirmed the Sprint 5 columns, foreign
  keys, status constraints, and required indexes.
- A second clean disposable database passed the complete migration chain, a
  Sprint 5 revert, and Sprint 5 reapplication; the disposable database was then
  removed.
- Local Redis is running, the backend starts with BullMQ enabled, and
  `/api/health` returns `{ "status": "ok" }` against the migrated database.
- The changed Sprint 5 backend files pass lint/format checks, the full backend
  build and all 19 tests pass, frontend lint and production build pass, and the
  AI service compiles and imports successfully from its virtual environment.
- Implementation-task matching, task assignment, GitHub repository automation,
  and their frontend admin screens are present after synchronizing `dev`.
- Submission/versioning, review/revision, release-request, ledger-only release,
  authorization, pagination, and notification routes are implemented on
  `feature/sprint-5-asaad-delivery`.
- Evaluation routes, queue producer/processor/recovery, admin evaluation pages,
  and the real FastAPI evaluation agent are integrated on the same feature
  branch. Submitted work now queues an evaluation automatically through the
  shared dispatcher contract.
- A disposable 22-migration database passed the full HTTP delivery flow:
  submission, revision, immutable replacement version, approval, release
  request, idempotent ledger-only posting, and final project completion.
- A fresh disposable 22-migration database also passed the merged live
  submission-evaluation flow: HTTP submission, BullMQ dispatch, FastAPI/Gemini
  evaluation, completed `evaluation_runs`/`agent_jobs` persistence, and admin
  detail/list reads. Its isolated database and Redis namespace were removed
  after verification.
- The seven Sprint 5 foundation tables and their TypeORM entities exist.
- Foreign keys and the main list/filter indexes for submissions, revisions,
  evaluations, repositories, collaborators, and release requests exist.
- Existing project and task statuses already cover the Sprint 5 delivery flow.
- `matching_runs.target_type = "task"` and `target_task_id` already support the
  database shape for task-level matching.

Shared-environment database gate:

- Ebrahim provisions a replacement hosted PostgreSQL/Supabase project and
  shares its secret connection values through the team's secret manager.
- Ebrahim runs `npm run db:show`, applies all 22 migrations deliberately, and
  repeats the schema verification used locally.
- The team must not reuse or circulate the expired Supabase URL.

Blocking application work:

- Customer/freelancer delivery, submission, revision, and release frontend
  services and workspaces are still pending.
- A replacement shared hosted database is still required before staging or
  multi-developer integration testing.

## Required Sprint 5 DB Additions

Ebrahim owns the coordinated Sprint 5 readiness migration for this section.
Asaad and Sameh review the parts belonging to their verticals. The later
delivery-contract migration is intentionally separate because the readiness
migration had already landed and been applied before the missing delivery
columns were discovered; do not rewrite an applied migration.

Implementation status (2026-08-15): the code below is implemented in
`1785500000000-Sprint5Readiness.ts` and matching TypeORM entities/DTOs. It was
applied and verified on a clean local PostgreSQL 17 + pgvector database. The
same verification remains required on the replacement hosted database.

The delivery contract required one forward-only follow-up migration,
`1785600000000-AddSprint5DeliveryContract.ts`, because the already-applied
foundation schema had no `project_submissions.submission_type` column and no
`escrow_ledger_entries.metadata` column. Do not edit the applied readiness
migration; apply both migrations in order.

### Add `freelancer_profiles.github_username`

Reason: GitHub invites need a stable username owned by the freelancer profile.

Migration:

- `github_username varchar(120) null`
- Index:
  - `freelancer_profiles_github_username_idx`
  - partial index where `"github_username" IS NOT NULL`

Entity:

- `FreelancerProfile.githubUsername: string | null`

DTO:

- Add `githubUsername?: string` to `UpdateFreelancerDto`
- Validate:
  - optional string
  - max 120
  - regex: GitHub username style, letters/numbers/hyphen, no leading/trailing hyphen

Frontend:

- Add field to profile page for freelancers only.
- This is required before repo collaboration invites, not required for account verification.

### Add task assignment audit fields

Reason: `project_tasks.assigned_freelancer_profile_id` exists, but Sprint 5 needs to know where the assignment came from.

Add nullable fields to `project_tasks`:

- `source_matching_run_id uuid null`
- `source_candidate_id uuid null`
- `assigned_by uuid null`
- `assigned_at timestamptz null`

Indexes:

- `project_tasks_source_matching_run_idx` on `source_matching_run_id` where not null
- `project_tasks_assigned_at_idx` on `project_id, assigned_at` where `assigned_at` is not null

Do not use `project_role_assignments` for implementation task assignments. That table has a unique active role constraint per project/phase/roleKey and is correct for planning roles, but implementation tasks can have many backend/frontend/design tasks with the same role.

### Align repository and workflow constraints

Add these contract-alignment changes in the same readiness migration:

- Extend `repository_collaborators_invite_status_check` with
  `missing_username`.
- Add a partial unique index allowing at most one non-archived repository per
  project.
- Add a partial unique index preventing duplicate `pending` or `approved`
  release requests for the same `submission_id + freelancer_profile_id`.
- Add a partial unique index preventing more than one `queued`, `running`, or
  `completed` evaluation run for the same non-null `submission_id`.

Use the existing canonical database values instead of adding aliases:

- Use `matching_runs.target_type = "task"`, not `implementation_task`.
- Use submission states `draft`, `submitted`, `under_review`,
  `changes_requested`, `approved`, `rejected`, and `superseded`.
- Store evaluation lifecycle in `evaluation_runs`; do not add `evaluating` or
  `ai_reviewed` to `project_submissions`.

## Team Ownership

### Rebalance summary

- Moved the NestJS evaluation queue/routes/recovery and the review UI from
  Asaad to Ebrahim, giving Ebrahim one complete evaluation vertical.
- Moved the admin submissions/evaluations/revisions screens from Muhanad to
  Ebrahim.
- Moved implementation-matching and repository frontend services/pages, plus
  the GitHub profile field UI, from Muhanad to Sameh.
- Asaad now concentrates on submission/payment persistence, notifications, and
  integration; Muhanad concentrates on customer/freelancer delivery surfaces
  and ledger-release UI.

### Asaad

Owner: submission/payment backend and final integration.

Asaad owns:

- `project_submissions`
- `project_submission_reviews`
- `project_revision_requests`
- Payment release request routes and admin release decisions.
- Ledger-only escrow releases with explicit transfer metadata.
- Submission and revision backend APIs.
- Final integration/merge checks.
- Making sure notifications fire for submission, evaluation, revision, and release events.

Asaad should not own in this sprint:

- FastAPI evaluation prompt internals.
- GitHub provider implementation.
- Implementation matching scoring logic.

### Ebrahim

Owner: database readiness and the complete evaluation/review vertical.

Ebrahim owns:

- The single Sprint 5 database readiness migration and corresponding entity/DTO
  alignment described above.
- Provision and migrate the replacement shared hosted database.
- Replace mock `/agents/evaluate-submission` with real AI behavior.
- Evaluation prompt, schema, normalization, fallback behavior.
- Add support for code/repo/pull request/text/Figma evidence.
- Return useful revision feedback, not generic text.
- Keep output deterministic enough for backend validation.
- NestJS evaluation DTOs, service, routes, queue producer, processor, retry, and
  recovery behavior.
- Typed `evaluations.ts` frontend service.
- Admin submissions/evaluations/revisions queue and submission review page.
- Customer/admin review UI hooks that consume Asaad's submission APIs.

Ebrahim should not edit:

- Payment release rules.
- Backend route names without updating this file.
- Submission persistence/versioning without syncing with Asaad.

### Sameh

Owner: implementation matching and repository automation end to end.

Sameh owns:

- Extending matching from planning roles to implementation tasks.
- Backend matching endpoint for task-level matching.
- Matching candidate pool filters for task skills, availability, rate, experience, task budget, and current active workload.
- Extending FastAPI matching contract to accept task targets.
- Admin approve/reject/rerun flow for task matches.
- GitHub repository controller/service.
- Creating one Nexus-owned private repository per implementation-ready project.
- Inviting assigned freelancers and syncing repository collaborators.
- Persisting repository and collaborator state, including retryable failures.
- Freelancer GitHub username profile field UI.
- Typed `repositories.ts` and `implementation-matching.ts` frontend services.
- Admin implementation-matching queue and repository/collaborator pages.

Sameh should reuse:

- `matching_runs`
- `matching_candidates`
- `matching_runs.target_task_id`
- `project_tasks.assigned_freelancer_profile_id`

Sameh should not create a second matching table.

Sameh should not edit:

- AI evaluation prompts.
- Payment release rules.
- Submission payload shape without syncing with Asaad.

### Muhanad

Owner: customer/freelancer delivery workspaces and payment-release UI.

Muhanad owns:

- Customer delivery workspace.
- Freelancer task board and submission screens.
- Typed `project-submissions.ts`, `revisions.ts`, and `release-requests.ts`
  frontend services.
- Admin delivery overview/project workspace shell.
- Admin escrow release request UI.
- Shared delivery status, milestone, task, and evidence components used by the
  customer and freelancer pages.

Frontend must call NestJS only. Do not call FastAPI or Stripe directly.

## Committed Sprint 5 Scope

This is the feasible two-week MVP for four developers. Work outside this list
does not enter Sprint 5 without removing another committed item.

In scope:

- Replacement shared database plus the verified Sprint 5 migration.
- Task-level matching, admin approval, and assignment audit trail.
- One private GitHub repository per project and collaborator invite/retry.
- Freelancer task board, submission versioning, and revision workflow.
- Real AI evaluation with queue/retry/recovery and human final approval.
- Customer delivery view and focused admin delivery queues.
- Ledger-only payment release requests and admin decisions.
- Notifications and one end-to-end happy-path test.

Deferred to Sprint 6:

- Live Stripe Connect transfers (`STRIPE_ENABLE_TRANSFERS` stays `false`).
- GitHub webhook ingestion, pull-request checks, and automatic collaborator
  removal.
- Implementation-task regeneration through `/agents/generate-task`.
- Advanced delivery analytics, bulk actions, and UI polish beyond the defined
  pages.
- Disputes, replacement assignees, and partial release edge cases beyond the
  documented MVP rules.

## Shared API Rules

Global backend prefix: `/api`

All Sprint 5 backend routes must:

- Use camelCase JSON.
- Return success as:

```json
{
  "status": "success",
  "data": {}
}
```

- Return paginated lists as:

```json
{
  "status": "success",
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

- Use auth guards.
- Use role guards.
- Store all important output in DB.
- Never rely on frontend state as source of truth.
- Never silently mock GitHub, evaluation, matching, or payment release.
- If AI/GitHub/Stripe is unavailable, store a failed/retryable status and show that clearly in UI.

## Sprint 5 State Rules

### Project statuses

Use existing statuses:

- `implementation_ready`: Scrum plan materialized, tasks exist.
- `matching`: implementation task matching is running.
- `matched`: implementation task matches have been approved, but not all work has started.
- `assigned`: implementation tasks have assigned freelancers.
- `active`: implementation work is in progress.
- `under_review`: at least one submitted task/milestone is awaiting review.
- `completed`: all milestones/tasks are approved and releases are complete.
- `disputed`: payment/review conflict.
- `cancelled`: project cancelled by admin/system rules.

Do not move a project back to `brief_complete`, `planning_matching`, or `planning_review` after escrow is funded.

### Task statuses

Use existing statuses:

- `todo`
- `blocked`
- `in_progress`
- `review`
- `changes_requested`
- `done`
- `cancelled`

Rules:

- A freelancer can only start/update tasks assigned to their profile.
- A task cannot move to `in_progress` until dependency tasks are `done`.
- A task moves to `review` when a submission is submitted.
- A task moves to `changes_requested` when admin/customer requests revisions.
- A task moves to `done` only after an approved submission.

### Submission statuses

Use the statuses already enforced by the database:

- `draft`
- `submitted`
- `under_review`
- `changes_requested`
- `approved`
- `rejected`
- `superseded`

Rules:

- Draft can be edited by the assigned freelancer.
- Submitted triggers evaluation automatically and moves to `under_review` once
  the evaluation run is queued.
- Evaluation state and results live in `evaluation_runs`; a completed AI review
  does not mean the submission is approved.
- Admin/customer decision is the final product decision.
- Revisions create a new submission version for the same
  task/milestone/freelancer and mark the replaced version `superseded` when the
  new version is submitted.

### Revision statuses

Use:

- `open`
- `in_progress`
- `resolved`
- `cancelled`

Rules:

- A revision request belongs to project, and optionally milestone/task/submission.
- A revision should point to the freelancer responsible for the work.
- Resolving a revision should happen through a new submitted version, not by editing the old approved/rejected submission.

### Payment release statuses

Use:

- `pending`
- `approved`
- `rejected`
- `released`
- `failed`
- `cancelled`

Rules:

- A release request can be created only for funded escrow.
- A release request should usually point to a milestone and approved submission.
- Release amount cannot exceed remaining held escrow.
- Sprint 5 uses ledger-only release with metadata
  `{ "transferMode": "ledger_only" }`.
- Keep `STRIPE_ENABLE_TRANSFERS=false`; live Connect transfers are Sprint 6 work.

## Backend Route Contracts

### Existing Sprint 4 routes reused

Keep these route names as they are:

- `GET /api/projects/:projectId/milestones`
- `GET /api/projects/:projectId/tasks`
- `PATCH /api/project-tasks/:taskId`
- `GET /api/projects/:projectId/matching/runs`
- `GET /api/matching/runs/:runId`
- `PATCH /api/matching/candidates/:candidateId/status`
- `POST /api/matching/runs/:runId/review`
- `GET /api/projects/:projectId/payments/summary`
- `GET /api/admin/payments`

### Freelancer profile GitHub field

#### `PATCH /api/freelancers/me`

Extend existing payload:

```json
{
  "githubUsername": "octocat"
}
```

Response uses existing freelancer profile response and includes:

```json
{
  "githubUsername": "octocat"
}
```

### Repository routes

Owner: Sameh.

#### `POST /api/projects/:projectId/repository`

Roles: admin

Purpose: create or return the Nexus-owned GitHub repository for a project.

Payload:

```json
{
  "provider": "github",
  "owner": "nexus-ai",
  "repoName": "project-bakery-ecommerce",
  "visibility": "private",
  "defaultBranch": "main",
  "description": "Implementation repository for Bakery Ecommerce"
}
```

Rules:

- Idempotent by `projectId`.
- If a repository already exists, return it instead of creating another GitHub repo.
- Store result in `project_repositories`.
- Status values: `pending`, `active`, `failed`, `archived`.

Response:

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "provider": "github",
    "owner": "nexus-ai",
    "repoName": "project-bakery-ecommerce",
    "repoUrl": "https://github.com/nexus-ai/project-bakery-ecommerce",
    "defaultBranch": "main",
    "status": "active",
    "createdAt": "2026-07-20T10:00:00.000Z"
  }
}
```

#### `GET /api/projects/:projectId/repository`

Roles: customer for own project, assigned freelancer, admin

Response: same repository object, plus collaborators:

```json
{
  "status": "success",
  "data": {
    "repository": {},
    "collaborators": []
  }
}
```

#### `POST /api/projects/:projectId/repository/collaborators/sync`

Roles: admin

Purpose: invite assigned freelancers to the project repo.

Payload:

```json
{
  "includeTaskAssignees": true,
  "includePlanningAssignees": false,
  "freelancerProfileIds": ["uuid"],
  "permission": "push"
}
```

Rules:

- Use `freelancer_profiles.github_username`.
- If a freelancer has no GitHub username, create collaborator row with `inviteStatus = missing_username`.
- If already invited, do not duplicate. Return current row.
- Store rows in `repository_collaborators`.

Response:

```json
{
  "status": "success",
  "data": {
    "repositoryId": "uuid",
    "invited": 2,
    "missingUsername": 1,
    "collaborators": []
  }
}
```

#### `POST /api/repository-collaborators/:collaboratorId/resend-invite`

Roles: admin

Payload:

```json
{
  "permission": "push"
}
```

Response: updated collaborator.

#### `GET /api/admin/repositories`

Roles: admin

Query:

- `status`
- `projectId`
- `page`
- `limit`

Response: paginated repositories with collaborator counts.

### Implementation matching routes

Owner: Sameh.

#### `POST /api/projects/:projectId/matching/implementation-tasks`

Roles: admin

Purpose: create task-level matching runs after Scrum plan materialization.

Payload:

```json
{
  "taskIds": ["uuid"],
  "milestoneId": "uuid",
  "mode": "sync",
  "filters": {
    "maxHourlyRate": 40,
    "minAvailabilityHours": 10,
    "skills": ["React", "NestJS"],
    "includeFreelancerIds": ["uuid"],
    "excludeFreelancerIds": ["uuid"],
    "limit": 10
  }
}
```

Rules:

- `taskIds` optional.
- `milestoneId` optional.
- If both are missing, match all unassigned materialized tasks.
- If both are present, `taskIds` wins.
- Only tasks in `todo`, `blocked`, or `changes_requested` can be matched.
- Do not create duplicate active matching runs for the same task.
- Use `matching_runs.target_type = "task"`.
- Use `matching_runs.target_task_id = task.id`.
- Store all candidates in `matching_candidates`.
- Project status becomes `matching`.

Response:

```json
{
  "status": "success",
  "data": {
    "projectId": "uuid",
    "runs": [
      {
        "id": "uuid",
        "targetType": "task",
        "targetTaskId": "uuid",
        "targetRoleKey": "frontend",
        "status": "completed",
        "candidateCount": 8,
        "summary": "Top candidates ranked for frontend checkout task."
      }
    ]
  }
}
```

#### Extend `GET /api/projects/:projectId/matching/runs`

Add optional query filters:

- `targetType=planning_role|task`
- `targetTaskId=uuid`
- `status`
- `page`
- `limit`

#### `POST /api/project-tasks/:taskId/assignment`

Roles: admin

Purpose: assign selected matching candidate or explicit freelancer to an implementation task.

Payload:

```json
{
  "candidateId": "uuid",
  "freelancerProfileId": "uuid",
  "sourceMatchingRunId": "uuid",
  "notes": "Best score and available this week."
}
```

Rules:

- `candidateId` or `freelancerProfileId` is required.
- If `candidateId` is provided, derive freelancer and matching run from candidate.
- Write:
  - `project_tasks.assigned_freelancer_profile_id`
  - `project_tasks.source_matching_run_id`
  - `project_tasks.source_candidate_id`
  - `project_tasks.assigned_by`
  - `project_tasks.assigned_at`
- Set task status to `todo` unless it is already `in_progress`.
- Notify freelancer.
- If all implementation tasks have assignees, project status becomes `assigned`.

Response:

```json
{
  "status": "success",
  "data": {
    "id": "task uuid",
    "status": "todo",
    "assignedFreelancerProfileId": "uuid",
    "sourceMatchingRunId": "uuid",
    "assignedAt": "2026-07-20T10:00:00.000Z"
  }
}
```

### Submission routes

Asaad owns this vertical.

#### `POST /api/projects/:projectId/submissions`

Roles: assigned freelancer, admin

Payload:

```json
{
  "milestoneId": "uuid",
  "taskId": "uuid",
  "repositoryId": "uuid",
  "submissionType": "pull_request",
  "title": "Checkout API implementation",
  "summary": "Implemented checkout session creation and webhook persistence.",
  "content": {
    "notes": "Includes tests and migration.",
    "checklist": ["API route", "Stripe webhook", "unit tests"]
  },
  "fileUrls": {
    "screenshots": ["https://..."],
    "attachments": []
  },
  "repoUrl": "https://github.com/nexus-ai/project-bakery-ecommerce",
  "branchName": "feat/checkout-api",
  "pullRequestUrl": "https://github.com/nexus-ai/project-bakery-ecommerce/pull/4",
  "commitSha": "abc123",
  "status": "submitted"
}
```

Rules:

- `taskId` is required for task submissions.
- `milestoneId` may be derived from task when omitted.
- Freelancer must be assigned to the task unless admin.
- Version increments per `taskId + freelancerProfileId`.
- If `status = submitted`, set `submittedAt`.
- If submitted, task status becomes `review`.
- If submitted, enqueue evaluation job.
- Store all data in `project_submissions`.

Response:

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "taskId": "uuid",
    "milestoneId": "uuid",
    "freelancerProfileId": "uuid",
    "version": 1,
    "status": "submitted",
    "submittedAt": "2026-07-20T10:00:00.000Z"
  }
}
```

#### `GET /api/projects/:projectId/submissions`

Roles: project customer, assigned freelancer, admin

Query:

- `taskId`
- `milestoneId`
- `status`
- `freelancerProfileId`
- `page`
- `limit`

Response: paginated `ProjectSubmission[]`.

#### `GET /api/project-submissions/:submissionId`

Roles: project customer, assigned freelancer, admin

Response includes:

- submission
- task
- milestone
- latest evaluation run
- reviews
- open revision requests

#### `PATCH /api/project-submissions/:submissionId`

Roles: submission owner while draft or changes requested, admin

Payload: same editable fields as create, except `projectId`, `version`, `reviewedBy`, `reviewedAt`.

#### `POST /api/project-submissions/:submissionId/submit`

Roles: submission owner, admin

Payload:

```json
{
  "summary": "Final notes before review"
}
```

Rules:

- Set status `submitted`.
- Set `submittedAt`.
- Set task status `review`.
- Enqueue evaluation if not already queued for this exact submission version.

### Review and revision routes

Owner: Asaad for backend contracts; Ebrahim owns the review UI.

#### `PATCH /api/project-submissions/:submissionId/review`

Roles: admin, project customer

Payload:

```json
{
  "decision": "changes_requested",
  "feedback": "Checkout works, but the webhook path is missing tests.",
  "requestedChanges": {
    "items": [
      {
        "area": "tests",
        "comment": "Add webhook success and duplicate event tests."
      }
    ]
  },
  "score": 72,
  "createRevisionRequest": true,
  "releasePayment": false
}
```

Allowed decisions:

- `approved`
- `changes_requested`
- `rejected`

Rules:

- Always create `project_submission_reviews`.
- If approved:
  - submission status `approved`
  - task status `done`
  - submission `approvedAt`
- If changes requested:
  - submission status `changes_requested`
  - task status `changes_requested`
  - create `project_revision_requests` when `createRevisionRequest = true`
- If rejected:
  - submission status `rejected`
  - task status `changes_requested` or `cancelled` depending admin choice later
- Do not release payment automatically unless `releasePayment = true` and release rules pass.

Response:

```json
{
  "status": "success",
  "data": {
    "submission": {},
    "review": {},
    "revisionRequest": {},
    "releaseRequest": null
  }
}
```

#### `POST /api/projects/:projectId/revision-requests`

Roles: admin, project customer

Payload:

```json
{
  "milestoneId": "uuid",
  "taskId": "uuid",
  "submissionId": "uuid",
  "assignedToFreelancerProfileId": "uuid",
  "priority": "high",
  "title": "Fix checkout webhook tests",
  "description": "The implementation needs duplicate event handling tests.",
  "requestedChanges": {
    "items": ["Add duplicate webhook test", "Show event id in logs"]
  },
  "dueAt": "2026-07-27T00:00:00.000Z"
}
```

Response: created `ProjectRevisionRequest`.

#### `GET /api/projects/:projectId/revision-requests`

Roles: project customer, assigned freelancer, admin

Query:

- `status`
- `taskId`
- `milestoneId`
- `assignedToFreelancerProfileId`
- `page`
- `limit`

#### `PATCH /api/revision-requests/:revisionRequestId/status`

Roles: assigned freelancer, admin

Payload:

```json
{
  "status": "in_progress",
  "notes": "Working on this now."
}
```

Allowed statuses:

- `open`
- `in_progress`
- `resolved`
- `cancelled`

### Evaluation routes

Owner: Ebrahim end to end.

#### `POST /api/project-submissions/:submissionId/evaluations`

Roles: admin

Purpose: manually queue or retry evaluation.

Payload:

```json
{
  "mode": "async",
  "reason": "manual_retry"
}
```

Rules:

- Create row in `evaluation_runs`.
- Create row in `agent_jobs` with job type `submission_evaluation`.
- Enqueue BullMQ job.

Response:

```json
{
  "status": "success",
  "data": {
    "evaluationRunId": "uuid",
    "agentJobId": "uuid",
    "status": "queued"
  }
}
```

#### `GET /api/project-submissions/:submissionId/evaluations`

Roles: project customer, assigned freelancer, admin

Response: list of evaluation runs for the submission.

#### `GET /api/evaluation-runs/:evaluationRunId`

Roles: project customer, assigned freelancer, admin

Response: evaluation run detail.

#### `POST /api/evaluation-runs/:evaluationRunId/retry`

Roles: admin

Payload:

```json
{
  "reason": "AI provider recovered"
}
```

#### `GET /api/admin/evaluations`

Roles: admin

Query:

- `status`
- `recommendation`
- `projectId`
- `submissionId`
- `page`
- `limit`

Response: paginated evaluation queue.

### Payment release routes

Owner: Asaad for backend; Muhanad owns the admin UI.

Sprint 5 UI must use these release-request routes, not the old direct whole-payment release endpoint.

#### `POST /api/projects/:projectId/payment-release-requests`

Roles: admin, project customer, assigned freelancer

Payload:

```json
{
  "milestoneId": "uuid",
  "submissionId": "uuid",
  "freelancerProfileId": "uuid",
  "amount": 2500,
  "currency": "EGP",
  "reason": "Milestone 1 accepted."
}
```

Rules:

- Freelancer can request release only for their own approved submission.
- Customer/admin can request release for an approved submission.
- Amount cannot exceed remaining held escrow.
- Create row in `payment_release_requests`.
- Do not write ledger release until approved.

Response: created release request.

#### `GET /api/projects/:projectId/payment-release-requests`

Roles: project customer, assigned freelancer, admin

Query:

- `status`
- `milestoneId`
- `freelancerProfileId`
- `page`
- `limit`

#### `GET /api/admin/payment-release-requests`

Roles: admin

Query:

- `status`
- `projectId`
- `freelancerProfileId`
- `page`
- `limit`

#### `PATCH /api/payment-release-requests/:requestId/review`

Roles: admin

Payload:

```json
{
  "decision": "approved",
  "reviewNotes": "Approved after accepted submission.",
  "releaseNow": true
}
```

Allowed decisions:

- `approved`
- `rejected`

Rules:

- If rejected, set status `rejected`.
- If approved and `releaseNow = false`, set status `approved`.
- If approved and `releaseNow = true`, write `escrow_ledger_entries` release.
- Write a posted ledger release with metadata
  `{ "transferMode": "ledger_only", "stripeTransferId": null }`.
- Do not call the Stripe Transfers API during Sprint 5.

Response:

```json
{
  "status": "success",
  "data": {
    "releaseRequest": {},
    "ledgerEntry": {},
    "stripeTransferId": null,
    "transferMode": "ledger_only"
  }
}
```

## AI Service Contracts

Frontend never calls FastAPI directly. NestJS calls FastAPI through `AI_SERVICE_URL`.

### `POST /agents/match-freelancers`

Sameh owns this.

Current contract remains, but must support implementation tasks.

Request:

```json
{
  "matchingRunId": "uuid",
  "targetType": "task",
  "targetRoleKey": "frontend",
  "targetTaskId": "uuid",
  "limit": 10,
  "project": {
    "id": "uuid",
    "title": "Bakery Ecommerce",
    "description": "Online bakery store",
    "budgetMin": 10000,
    "budgetMax": 20000,
    "currency": "EGP",
    "deadline": "2026-08-20T00:00:00.000Z",
    "requiredSkills": ["React", "Stripe", "Responsive Design"]
  },
  "brief": {
    "summary": "Customer wants bakery website and mobile app.",
    "briefText": "Full locked brief text",
    "requiredSkills": ["React", "NestJS", "Stripe"]
  },
  "task": {
    "id": "uuid",
    "title": "Build checkout UI",
    "description": "Implement cart checkout UI and Stripe redirect.",
    "roleKey": "frontend",
    "requiredSkills": ["React", "Stripe"],
    "estimatedHours": 24,
    "acceptanceCriteria": [
      "Customer can review cart",
      "Customer can start checkout"
    ],
    "dependencies": ["uuid"]
  },
  "candidates": [
    {
      "freelancerProfileId": "uuid",
      "name": "Mina",
      "headline": "Frontend engineer",
      "skills": ["React", "Next.js"],
      "skillScores": [{ "skill": "React", "score": 4.6 }],
      "averageSkillScore": 4.3,
      "availabilityHours": 20,
      "hourlyRate": 25,
      "yearsExperience": 3,
      "profileSummary": "AI-generated summary",
      "embeddingSimilarity": 0.82,
      "activeTaskCount": 1,
      "activeProjectCount": 1
    }
  ]
}
```

Response:

```json
{
  "matchingRunId": "uuid",
  "summary": "Ranked 10 freelancers for checkout UI.",
  "candidates": [
    {
      "freelancerProfileId": "uuid",
      "rank": 1,
      "score": 88.5,
      "scoreBreakdown": {
        "skills": 35,
        "projectFit": 18,
        "availability": 14,
        "experience": 10,
        "rateFit": 11.5
      },
      "rationale": "Strong React and Stripe evidence with enough availability.",
      "evidence": {
        "topSkills": ["React 4.6", "Stripe 4.1"],
        "availability": "20 hrs/week",
        "rate": "25 EGP/hr"
      }
    }
  ]
}
```

### `POST /agents/evaluate-submission`

Ebrahim owns this.

Request:

```json
{
  "project": {
    "projectId": "uuid",
    "title": "Bakery Ecommerce"
  },
  "brief": {
    "briefId": "uuid",
    "summary": "Online bakery store with payments and stock dashboard.",
    "projectType": "ecommerce",
    "domain": "bakery",
    "acceptanceCriteria": ["Customers can buy online", "Admin can track stock"]
  },
  "projectSpec": {
    "architecture": {},
    "designSystem": {},
    "apiContract": {},
    "dataModel": {},
    "conventions": {}
  },
  "task": {
    "taskId": "uuid",
    "title": "Build checkout API",
    "description": "Create Stripe checkout session endpoint.",
    "isSpecTask": false,
    "deliverables": ["API endpoint", "Webhook persistence"],
    "acceptanceCriteria": [
      "Endpoint creates checkout session",
      "Webhook is idempotent"
    ]
  },
  "submission": {
    "submissionId": "uuid",
    "submissionType": "pull_request",
    "submissionUrl": null,
    "repositoryUrl": "https://github.com/nexus-ai/project-bakery-ecommerce",
    "pullRequestUrl": "https://github.com/nexus-ai/project-bakery-ecommerce/pull/4",
    "commitSha": "abc123",
    "submissionText": "Freelancer notes",
    "notes": "Includes tests."
  }
}
```

Response:

```json
{
  "passed": false,
  "score": 72,
  "revisionRequested": true,
  "revisionNotes": "Add duplicate webhook event handling and tests.",
  "requiresHumanReview": true,
  "rubric": [
    {
      "criterion": "Endpoint creates checkout session",
      "met": true,
      "evidence": "API route exists and validates amount."
    },
    {
      "criterion": "Webhook is idempotent",
      "met": false,
      "evidence": "Webhook stores events but lacks duplicate handling test."
    }
  ]
}
```

The backend normalizes this response and stores it in `evaluation_runs`. It
derives the database recommendation as `approve`, `changes_requested`, or
`manual_review`; `reject` remains available for an explicit product decision.

### `POST /agents/generate-task`

Sameh can use this only if implementation tasks need regeneration or expansion.

Do not replace the Scrum Master project-plan flow with this. The source of truth for Sprint 5 tasks is `project_tasks` created by materializing the approved `project_plans` row.

## Queue And Event Flow

Owner: Ebrahim.

Integrated queue constants:

- Queue: `submission-evaluation`
- Job name: `evaluate-submission`
- Agent job type: `submission_evaluation`

Event chain:

1. Freelancer submits work.
2. Backend saves `project_submissions`.
3. Backend sets task status `review`.
4. Backend creates `evaluation_runs` row with status `queued`.
5. Backend creates `agent_jobs` row with job type `submission_evaluation`.
6. BullMQ processes job and calls `/agents/evaluate-submission`.
7. Backend stores result in `evaluation_runs`.
8. Evaluation run becomes `completed`; submission remains `under_review`.
9. Admin/customer can approve, reject, or request revision.

Recovery:

- Add `submission_evaluation` to `AiJobRecoveryService` recoverable job types.
- Failed evaluation jobs older than 1 hour should be requeued from DB input.
- Manual retry button calls `POST /api/evaluation-runs/:evaluationRunId/retry`.

Integration seam already implemented by Asaad:

- `DeliveryService` injects the optional
  `SUBMISSION_EVALUATION_DISPATCHER` token from
  `src/delivery/submission-evaluation-dispatcher.ts`.
- Ebrahim's evaluation service now implements `queueSubmissionEvaluation` and
  is registered against that token through `EvaluationsModule`, which is
  imported by `DeliveryModule`.
- The provider queues the database-backed evaluation; the delivery service then
  moves the submission to `under_review` and stores the evaluation-run and
  agent-job IDs in submission metadata.
- If queueing fails, the submitted row remains visible with an explicit failed
  dispatch state. The API never reports a mock or unqueued evaluation as
  successful.

## Frontend Route And Page Contracts

Frontend ownership is split by vertical below. Service names and routes are
fixed here.

### Add service constants

Add `deliveryEndpoints` in `src/lib/api.ts`.

```ts
export const deliveryEndpoints = {
  repositories: {
    create: (projectId: string) => `/projects/${projectId}/repository`,
    projectRepository: (projectId: string) =>
      `/projects/${projectId}/repository`,
    syncCollaborators: (projectId: string) =>
      `/projects/${projectId}/repository/collaborators/sync`,
    resendInvite: (collaboratorId: string) =>
      `/repository-collaborators/${collaboratorId}/resend-invite`,
    adminList: '/admin/repositories',
  },
  implementationMatching: {
    startTasks: (projectId: string) =>
      `/projects/${projectId}/matching/implementation-tasks`,
    assignTask: (taskId: string) => `/project-tasks/${taskId}/assignment`,
  },
  submissions: {
    create: (projectId: string) => `/projects/${projectId}/submissions`,
    projectList: (projectId: string) => `/projects/${projectId}/submissions`,
    detail: (submissionId: string) => `/project-submissions/${submissionId}`,
    update: (submissionId: string) => `/project-submissions/${submissionId}`,
    submit: (submissionId: string) =>
      `/project-submissions/${submissionId}/submit`,
    review: (submissionId: string) =>
      `/project-submissions/${submissionId}/review`,
    freelancerList: '/freelancer/submissions',
    adminList: '/admin/submissions',
  },
  revisions: {
    create: (projectId: string) => `/projects/${projectId}/revision-requests`,
    projectList: (projectId: string) =>
      `/projects/${projectId}/revision-requests`,
    updateStatus: (revisionRequestId: string) =>
      `/revision-requests/${revisionRequestId}/status`,
  },
  evaluations: {
    create: (submissionId: string) =>
      `/project-submissions/${submissionId}/evaluations`,
    submissionList: (submissionId: string) =>
      `/project-submissions/${submissionId}/evaluations`,
    detail: (evaluationRunId: string) => `/evaluation-runs/${evaluationRunId}`,
    retry: (evaluationRunId: string) =>
      `/evaluation-runs/${evaluationRunId}/retry`,
    adminList: '/admin/evaluations',
  },
  releaseRequests: {
    create: (projectId: string) =>
      `/projects/${projectId}/payment-release-requests`,
    projectList: (projectId: string) =>
      `/projects/${projectId}/payment-release-requests`,
    adminList: '/admin/payment-release-requests',
    review: (requestId: string) =>
      `/payment-release-requests/${requestId}/review`,
  },
};
```

### Add service files

- Sameh: `src/services/repositories.ts`
- Sameh: `src/services/implementation-matching.ts`
- Muhanad: `src/services/project-submissions.ts`
- Ebrahim: `src/services/evaluations.ts`
- Muhanad: `src/services/revisions.ts`
- Muhanad: `src/services/release-requests.ts`

Do not put all Sprint 5 calls inside `admin.ts`; keep vertical service files small and typed.

### Customer pages

#### `/projects/:id/work`

Owner: Muhanad.

Purpose: customer sees implementation progress.

Show:

- Project status.
- Repository link if active.
- Milestone timeline.
- Tasks grouped under milestones.
- Current assignee.
- Submission status.
- Evaluation summary once available.
- Revision requests.
- Payment/release state per milestone.

Customer actions:

- View submission.
- Request revision.
- Approve submission if allowed.
- View release requests.

Do not show:

- Internal AI prompt.
- Hidden matching score internals beyond plain reasons.

#### `/projects/:id/submissions/:submissionId`

Owner: Ebrahim, using Asaad's backend review contract.

Purpose: customer review page.

Show:

- Task and acceptance criteria.
- Freelancer notes.
- PR/repo/file links.
- AI evaluation summary.
- Findings and acceptance coverage.
- Review history.
- Buttons:
  - Approve
  - Request revision
  - Reject

### Freelancer pages

#### `/freelancer/projects/:projectId`

Owner: Muhanad.

Enhance existing page.

Show:

- Assigned implementation tasks.
- Dependency locks.
- Repository invite status.
- Role/task brief.
- Submission status.
- Revision requests.
- Payment release status.

#### `/freelancer/projects/:projectId/tasks/:taskId`

Owner: Muhanad.

Purpose: task work page.

Show:

- Task title/description.
- Acceptance criteria.
- Dependencies.
- Milestone.
- Repository link.
- Submission form.

Submission form fields:

- `submissionType`
- `title`
- `summary`
- `repoUrl`
- `branchName`
- `pullRequestUrl`
- `commitSha`
- `fileUrls`
- `content.notes`

Buttons:

- Save draft
- Submit for review

Disable submit if:

- Task not assigned to current freelancer.
- Dependency tasks are not done.
- Task is already `done`.

### Admin pages

#### `/dashboard/admin/delivery`

Owner: Muhanad.

Purpose: high-level implementation control room.

Show:

- Projects in `implementation_ready`, `matching`, `assigned`, `active`, `under_review`.
- Cards:
  - tasks unassigned
  - tasks in review
  - revisions open
  - release requests pending
- Table by project:
  - project
  - milestone count
  - task count
  - unassigned tasks
  - pending submissions
  - open revisions
  - held escrow
  - next action

#### `/dashboard/admin/projects/:projectId/delivery`

Owner: Muhanad for the shell and shared status components. Sameh supplies the
repository/matching panels; Ebrahim supplies evaluation/review panels.

Purpose: detailed admin implementation workflow.

Sections:

1. Repository
2. Implementation task matching
3. Task assignments
4. Submissions and evaluations
5. Revisions
6. Payment release requests

#### `/dashboard/admin/submissions`

Owner: Ebrahim.

Purpose: review submitted implementation work.

Filters:

- status
- project
- freelancer
- evaluation recommendation
- date range

Actions:

- Review
- Retry evaluation
- Request revision
- Approve
- Reject

#### `/dashboard/admin/repositories`

Owner: Sameh.

Purpose: GitHub repo operations.

Show:

- repository status
- collaborator invite status
- missing GitHub usernames
- resend invite
- open repo

#### `/dashboard/admin/payment-release-requests`

Owner: Muhanad.

Purpose: escrow release decisions.

Show:

- request status
- project
- milestone
- submission
- freelancer
- amount
- available escrow
- transfer mode (`ledger_only` in Sprint 5)

Actions:

- approve and release
- approve only
- reject

## Backend Implementation Notes

### Security

- Customer can only view/update their projects.
- Freelancer can only see tasks assigned to them.
- Freelancer can only submit work for assigned tasks.
- Admin can see and edit everything.
- Do not expose other freelancers' private Stripe or CV data.

### Performance

- Use indexed filters already present on:
  - `project_submissions.project_id, status`
  - `project_submissions.task_id, status`
  - `project_revision_requests.project_id, status`
  - `evaluation_runs.project_id, status`
  - `payment_release_requests.project_id, status`
  - `project_tasks.project_id, status`
- Paginate admin lists.
- Do not load all submissions/reviews/evaluations for admin list pages.
- Use detail endpoints for heavy objects.
- For matching candidate pools, cap default limit and prefilter in SQL before calling AI.

### Idempotency

- Repository creation idempotent by `projectId`.
- Collaborator invite idempotent by `repositoryId + freelancerProfileId`.
- Evaluation job idempotent by immutable `submissionId + status in queued/running/completed`.
- Release request prevents duplicate pending/approved releases for either
  `milestoneId + freelancerProfileId` or
  `submissionId + freelancerProfileId`.
- Task assignment should not overwrite an assigned task unless admin passes an explicit `replaceExisting: true` later. Do not add replacement in Sprint 5 unless needed for demo.

## Environment Variables

Backend:

- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_DEFAULT_VISIBILITY=private`
- `GITHUB_API_URL=https://api.github.com`
- `STRIPE_ENABLE_TRANSFERS=false` for all Sprint 5 environments
- Existing Redis/BullMQ env
- Existing Stripe env
- Existing `AI_SERVICE_URL`

AI service:

- Existing Gemini env
- Optional `GEMINI_EVALUATION_MODEL`

Frontend:

- Existing `NEXT_PUBLIC_API_URL`

## Sprint 5 Acceptance Checklist

Sprint 5 is done when:

- The replacement shared database is reachable and all 22 committed migrations,
  including `1785500000000-Sprint5Readiness.ts` and
  `1785600000000-AddSprint5DeliveryContract.ts`, are applied.
- Admin can create/open a GitHub repository for an implementation-ready project.
- Freelancers can save GitHub usernames.
- Admin can sync repo collaborators from assigned task freelancers.
- Admin can start implementation matching for unassigned tasks.
- Admin can approve a candidate and assign a freelancer to a task.
- Freelancer sees assigned implementation tasks.
- Freelancer can submit a task with PR/repo/file/text evidence.
- Submission is stored in DB with versioning.
- Submission automatically queues evaluation.
- AI evaluation returns real findings, acceptance coverage, score, and revision recommendation.
- Admin/customer can approve, reject, or request revisions.
- Revision request is stored and visible to freelancer.
- New submission version can resolve a revision.
- Approved submission can create a payment release request.
- Admin can approve/reject release request.
- Approved release writes a ledger-only escrow entry with explicit transfer
  metadata; no Stripe transfer is attempted.
- Customer sees project progress, submissions, revisions, and release state.
- Admin dashboards show delivery queues without depending on mock data.
- Backend build passes.
- Frontend build passes.
- AI service compile/import check passes.

## Remaining Integration Order

1. Ebrahim provisions the replacement hosted database, applies/verifies all 22
   migrations, and publishes only the secret-manager references to the team.
2. Muhanad builds the customer/freelancer workspace shell plus delivery,
   submission, revision, and release services/pages against the fixed routes in
   this document.
3. Asaad reviews the merged cross-vertical notifications and runs final
   integration checks after Muhanad's UI lands.
4. The team runs an end-to-end test against the replacement shared database:
   - funded project
   - materialized Scrum plan
   - implementation matching
   - assigned freelancer
   - GitHub invite
   - submission
   - AI evaluation
   - revision
   - approval
   - release request
   - ledger release
5. Each owner demonstrates their vertical against the replacement shared
   database; Asaad signs off only after backend, frontend, and AI checks pass.
