# Sprint 4 Team Handoff

Sprint 4 moves Nexus AI from "brief and verification demo" into the real project delivery flow:

- Completed customer briefs enter a mandatory planning phase.
- The platform matches and assigns two planning freelancers first: `architect` and `ui_ux`.
- Architect and UI/UX freelancers submit planning deliverables.
- The scrum master agent combines those deliverables into a timeline, milestones, tasks, dependencies, and implementation plan.
- Admin reviews and approves matching, assignments, planning outputs, and payment state before the customer sees final assignments.
- Stripe-backed escrow/payment foundations are wired for project deposits and later milestone releases.

This file is the contract for frontend, backend, and AI service. Do not create alternate route names or payload shapes. If a change is truly needed, update this file first.

## Current Foundation Already In The Repo

Global backend prefix: `/api`

The Sprint 4 database foundation is already present in migration:

- `1784900000000-Sprint4PlanningMatchingPayments.ts`

The following tables/entities exist now and should be used as source of truth:

- `matching_runs`
- `matching_candidates`
- `project_role_assignments`
- `project_planning_submissions`
- `project_plans`
- `project_specs`
- `project_milestones`
- `project_tasks`
- `project_task_dependencies`
- `project_status_history`
- `project_payments`
- `escrow_ledger_entries`
- `stripe_webhook_events`
- Existing freelancer tables:
  - `freelancer_profiles`
  - `freelancer_skill_scores`
  - `freelancer_profile_embeddings`
  - `freelancer_assessments`
- Existing project/brief tables:
  - `projects`
  - `briefs`
  - `brief_embeddings`
  - `brief_messages`
- Existing queue table:
  - `agent_jobs`

Important queue behavior already decided:

- BullMQ handles fast retries first: 3 attempts with exponential backoff.
- `AiJobRecoveryService` checks `agent_jobs` every 15 minutes.
- Failed recoverable AI jobs older than 1 hour are requeued from DB input.
- Recoverable job types today:
  - `cv_extraction`
  - `assessment_generation`
  - `profile_embedding`
- The user must not be asked to upload a CV again just because AI extraction or assessment generation failed.
- Manual retry buttons may exist, but normal temporary AI failures should recover through jobs.

## Team Ownership

### Sameh

Owner: matching agent logic in the AI service.

Sameh owns:

- `POST /agents/match-freelancers`
- Candidate ranking formula.
- Match reasons and evidence.
- Matching response schema alignment with backend DTOs.
- No frontend calls to this service directly.

Do not edit:

- Stripe/payment code.
- Frontend service route names.
- Backend route names without updating this file.

### Shahd

Owner: scrum master / planning agent logic in the AI service.

Shahd owns:

- `POST /agents/generate-project-plan`
- Optional `POST /agents/evaluate-planning-submission`
- Timeline generation.
- Task graph generation.
- Dependency ordering.
- Risk notes and acceptance criteria.

Do not edit:

- Payment backend.
- Matching route names.
- Frontend service route names without syncing with Muhanad.

### Ebrahim

Owner: NestJS backend for matching, planning, assignments, and admin review.

Ebrahim owns:

- Matching controllers/services.
- Planning submission controllers/services.
- Project plan generation endpoints.
- Assignment endpoints.
- Status transition rules.
- Admin review endpoints.
- Queue producers for matching and scrum master jobs if async.

Do not edit:

- Stripe provider secrets/webhook handling except consuming payment status.
- AI prompt internals except DTO contracts.

### Muhanad

Owner: frontend for Sprint 4.

Muhanad owns:

- Customer project planning UI.
- Admin matching review UI.
- Admin planning review UI.
- Freelancer assigned planning work UI.
- Payment UI surfaces that call backend routes.
- Frontend service files for Sprint 4 routes.

Do not call:

- FastAPI AI service directly.
- Stripe secret routes directly.
- Any route name not listed here.

### Asaad

Owner: payment backend, integration, queue reliability, seeds, and final merge.

Asaad owns:

- Stripe backend service.
- Stripe webhook endpoint.
- Escrow ledger writes.
- Payment state transitions.
- Sprint 4 integration and merge checks.
- Keeping `.env` requirements clear.

## Shared API Rules

All new Sprint 4 backend routes must follow this unless a route is a Stripe webhook:

- Use `/api` prefix.
- Use camelCase JSON.
- Return success as:

```json
{
  "status": "success",
  "data": {}
}
```

- Return lists as:

```json
{
  "status": "success",
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

- Use existing auth guards and role guards.
- Frontend calls NestJS only.
- NestJS calls FastAPI through `AI_SERVICE_URL`.
- NestJS calls Stripe through backend secrets only.
- Store all AI outputs used by product flow in DB.
- Never rely on frontend local state as source of truth.
- Never silently mock matching, planning, or payment results.
- If an AI job fails, write an `agent_jobs` row and show recoverable/pending UI.

## Sprint 4 Route Map

These route names are final for Sprint 4.

### Matching Routes

| Method | Route | Owner | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/projects/:projectId/matching/planning-roles` | Ebrahim | Create matching runs for `architect` and `ui_ux`. |
| `GET` | `/api/projects/:projectId/matching/runs` | Ebrahim | List matching runs for one project. |
| `GET` | `/api/matching/runs/:runId` | Ebrahim | Get one run with candidates. |
| `PATCH` | `/api/matching/candidates/:candidateId/status` | Ebrahim | Shortlist, select, or reject one candidate. |
| `POST` | `/api/matching/runs/:runId/review` | Ebrahim | Admin finalizes a matching run. |
| `POST` | `/api/projects/:projectId/role-assignments` | Ebrahim | Assign selected freelancer to planning role. |
| `GET` | `/api/projects/:projectId/role-assignments` | Ebrahim | Customer/admin/freelancer-safe team assignments. |
| `PATCH` | `/api/project-role-assignments/:assignmentId/status` | Ebrahim | Accept, decline, start, complete, replace, or cancel assignment. |
| `GET` | `/api/projects/:projectId/team` | Ebrahim | Customer-facing selected project team. |
| `GET` | `/api/freelancer/projects/assigned` | Ebrahim | Freelancer-facing assigned project work. |

### Planning Routes

| Method | Route | Owner | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/projects/:projectId/planning-submissions` | Ebrahim | Architect/UIUX submits planning deliverable. |
| `GET` | `/api/projects/:projectId/planning-submissions` | Ebrahim | List project planning submissions. |
| `GET` | `/api/planning-submissions/:submissionId` | Ebrahim | Load one submission. |
| `PATCH` | `/api/planning-submissions/:submissionId/review` | Ebrahim | Admin approves or requests changes. |
| `POST` | `/api/projects/:projectId/plans/generate` | Ebrahim | Queue or run scrum master plan generation. |
| `GET` | `/api/projects/:projectId/plans` | Ebrahim | List generated project plans. |
| `GET` | `/api/project-plans/:planId` | Ebrahim | Load plan detail. |
| `PATCH` | `/api/project-plans/:planId/review` | Ebrahim | Admin approves or requests changes. |
| `POST` | `/api/project-plans/:planId/materialize` | Ebrahim | Create milestones, tasks, dependencies, and project spec. |
| `GET` | `/api/projects/:projectId/milestones` | Ebrahim | List milestones. |
| `GET` | `/api/projects/:projectId/tasks` | Ebrahim | List project tasks. |
| `PATCH` | `/api/project-tasks/:taskId` | Ebrahim | Update task status/assignment fields. |

### Admin Routes

| Method | Route | Owner | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/matching/runs` | Ebrahim | Admin matching queue. |
| `GET` | `/api/admin/planning/submissions` | Ebrahim | Admin planning submission queue. |
| `GET` | `/api/admin/project-plans` | Ebrahim | Admin generated plan queue. |
| `GET` | `/api/admin/payments` | Asaad | Admin payment/escrow overview. |

### Payment Routes

| Method | Route | Owner | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/payments/customer/setup-intent` | Asaad | Create Stripe setup intent for customer payment method. |
| `POST` | `/api/payments/freelancer/onboarding-link` | Asaad | Create Stripe Connect onboarding link. |
| `GET` | `/api/payments/freelancer/account` | Asaad | Read freelancer Stripe account status. |
| `POST` | `/api/projects/:projectId/payments/escrow-intent` | Asaad | Create project or milestone escrow payment intent. |
| `GET` | `/api/projects/:projectId/payments` | Asaad | List project payments. |
| `POST` | `/api/projects/:projectId/payments/:paymentId/release` | Asaad | Admin/customer-approved milestone release. |
| `POST` | `/api/payments/webhooks/stripe` | Asaad | Stripe raw-body webhook. No auth guard. |

### AI Gateway Routes In NestJS

These are backend-to-AI gateway routes. Frontend should not use them directly unless it is an admin/dev diagnostic screen.

| Method | Route | Calls AI Service |
| --- | --- | --- |
| `POST` | `/api/ai/extract-cv` | `/agents/extract-cv` |
| `POST` | `/api/ai/validate-brief` | `/agents/validate-brief` |
| `POST` | `/api/ai/generate-assessment` | `/agents/generate-assessment` |
| `POST` | `/api/ai/grade-assessment` | `/agents/grade-assessment` |
| `POST` | `/api/ai/generate-embedding` | `/agents/generate-embedding` |
| `POST` | `/api/ai/match-freelancers` | `/agents/match-freelancers` |
| `POST` | `/api/ai/generate-project-plan` | `/agents/generate-project-plan` |

## Backend Contracts

### Start Planning Matching

`POST /api/projects/:projectId/matching/planning-roles`

Auth: admin.

Use when project brief is complete and we need mandatory planning roles.

Request:

```json
{
  "roles": ["architect", "ui_ux"],
  "filters": {
    "maxHourlyRate": 500,
    "minAvailabilityHours": 10,
    "skills": ["React", "NestJS", "UI/UX"],
    "includeFreelancerIds": [],
    "excludeFreelancerIds": []
  }
}
```

Behavior:

- Validate project exists.
- Validate project brief is complete.
- Set project `status` to `planning_matching` if not already later.
- Set project `planningStatus` to `matching`.
- Create one `matching_runs` row per requested role.
- Snapshot project, brief, filters, and candidate pool into `matching_runs.inputSnapshot`.
- Call AI matching service now or enqueue an `agent_jobs` row if async.
- Store ranked candidates in `matching_candidates`.

Response:

```json
{
  "status": "success",
  "data": {
    "projectId": "uuid",
    "projectStatus": "planning_matching",
    "planningStatus": "matching",
    "runs": [
      {
        "id": "uuid",
        "targetType": "planning_role",
        "targetRoleKey": "architect",
        "status": "completed",
        "candidateCount": 5
      },
      {
        "id": "uuid",
        "targetType": "planning_role",
        "targetRoleKey": "ui_ux",
        "status": "completed",
        "candidateCount": 5
      }
    ]
  }
}
```

### Matching Run Detail

`GET /api/matching/runs/:runId`

Auth: admin.

Response:

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "targetType": "planning_role",
    "targetRoleKey": "architect",
    "status": "completed",
    "summary": "5 strong matches found.",
    "filters": {},
    "startedAt": "2026-07-14T10:00:00.000Z",
    "completedAt": "2026-07-14T10:00:20.000Z",
    "candidates": [
      {
        "id": "uuid",
        "freelancerProfileId": "uuid",
        "rank": 1,
        "score": 91.5,
        "status": "recommended",
        "rationale": "Strong backend architecture score, enough availability, and rate fits budget.",
        "scoreBreakdown": {
          "skillFit": 35,
          "availabilityFit": 15,
          "experienceFit": 15,
          "budgetFit": 15,
          "projectFit": 10,
          "embeddingFit": 10
        },
        "evidence": {
          "matchedSkills": ["NestJS", "PostgreSQL", "System Design"],
          "missingSkills": [],
          "risks": ["Only 10 hrs/week available"],
          "rateNotes": "Within target rate",
          "availabilityNotes": "Can support planning phase"
        },
        "freelancer": {
          "name": "Aly Example",
          "email": "aly@example.com",
          "headline": "Backend Architect",
          "hourlyRate": 350,
          "availabilityHoursPerWeek": 15,
          "assessmentScore": 86,
          "topSkills": [
            { "skill": "System Design", "score": 4.8 },
            { "skill": "NestJS", "score": 4.6 }
          ]
        }
      }
    ]
  }
}
```

### Update Candidate Status

`PATCH /api/matching/candidates/:candidateId/status`

Auth: admin.

Request:

```json
{
  "status": "shortlisted",
  "rejectionReason": null
}
```

Allowed statuses:

- `recommended`
- `shortlisted`
- `selected`
- `rejected`
- `assigned`

Rules:

- `selected` requires admin.
- `rejected` should store `rejectionReason` if provided.
- Do not create assignments here. Assignments are created through `/role-assignments`.

### Review Matching Run

`POST /api/matching/runs/:runId/review`

Auth: admin.

Request:

```json
{
  "selectedCandidateIds": ["uuid"],
  "notes": "Selected for architecture planning."
}
```

Behavior:

- Mark selected candidates as `selected`.
- Mark run `reviewed`.
- Store `reviewedBy` and `reviewedAt`.
- Does not assign automatically unless explicitly requested later.

### Create Role Assignment

`POST /api/projects/:projectId/role-assignments`

Auth: admin.

Request:

```json
{
  "roleKey": "architect",
  "phase": "planning",
  "freelancerProfileId": "uuid",
  "sourceMatchingRunId": "uuid",
  "sourceCandidateId": "uuid",
  "decisionReason": "Best architecture fit and available this week."
}
```

Behavior:

- Validate freelancer is approved and eligible.
- Validate candidate belongs to matching run/project if source IDs are provided.
- Snapshot:
  - `hourlyRateSnapshot`
  - `availabilityHoursSnapshot`
  - `scoreSnapshot`
- Create `project_role_assignments`.
- Mark candidate `assigned`.
- If both `architect` and `ui_ux` roles are assigned, set:
  - project `status`: `planning_assigned`
  - project `planningStatus`: `assigned`
  - project `assignedAt`: current time
- Customer can no longer delete project after assignment.

Response:

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "projectId": "uuid",
    "roleKey": "architect",
    "phase": "planning",
    "status": "assigned",
    "freelancerProfileId": "uuid",
    "assignedAt": "2026-07-14T10:10:00.000Z"
  }
}
```

### Submit Planning Deliverable

`POST /api/projects/:projectId/planning-submissions`

Auth: freelancer assigned to the project role.

Request for architect:

```json
{
  "assignmentId": "uuid",
  "submissionType": "architecture",
  "title": "Architecture proposal v1",
  "summary": "NestJS API, PostgreSQL, Redis queue, Next frontend, Stripe escrow.",
  "content": {
    "systemOverview": "Short architecture explanation",
    "modules": [
      {
        "name": "Auth",
        "responsibility": "Signup, login, profile completion"
      }
    ],
    "dataModelNotes": ["Use project_tasks for implementation work"],
    "apiNotes": ["Frontend talks to Nest only"],
    "securityNotes": ["Keep Stripe secrets server-side"],
    "deploymentNotes": ["Redis required for workers"]
  },
  "fileUrls": []
}
```

Request for UI/UX:

```json
{
  "assignmentId": "uuid",
  "submissionType": "ui_ux",
  "title": "UI/UX proposal v1",
  "summary": "Clean dashboard-oriented flow for customer and freelancer.",
  "content": {
    "userFlows": [
      {
        "name": "Customer reviews planning team",
        "steps": ["Open project", "View assigned architect/UIUX", "Approve plan"]
      }
    ],
    "screens": [
      {
        "name": "Project planning",
        "purpose": "Show team, deliverables, plan status, payment status"
      }
    ],
    "designSystem": {
      "primaryColor": "#14523d",
      "tone": "clean, professional, supportive"
    },
    "accessibilityNotes": ["Visible focus states", "Readable status colors"]
  },
  "fileUrls": []
}
```

Behavior:

- Create `project_planning_submissions`.
- Do not set assignment status to `submitted`; that status belongs to `project_planning_submissions`.
- Keep assignment `in_progress` while work is submitted for admin review.
- Set assignment `completed` only after the related planning submission is approved.
- Admin reviews before scrum master can generate final plan.

### Review Planning Submission

`PATCH /api/planning-submissions/:submissionId/review`

Auth: admin.

Request:

```json
{
  "status": "approved",
  "adminNotes": "Good enough for plan generation."
}
```

Allowed statuses:

- `approved`
- `changes_requested`
- `rejected`

Rules:

- If status is `changes_requested`, freelancer can submit a new version.
- Do not overwrite old content. Use `version` for new submissions.
- Scrum master plan generation requires approved `architecture` and approved `ui_ux`.

### Generate Project Plan

`POST /api/projects/:projectId/plans/generate`

Auth: admin.

Request:

```json
{
  "architectureSubmissionId": "uuid",
  "uiuxSubmissionId": "uuid",
  "options": {
    "sprintLengthDays": 7,
    "targetStartDate": "2026-07-20",
    "targetEndDate": "2026-08-20"
  }
}
```

Behavior:

- Validate both submissions are approved.
- Create an `agent_jobs` row with `jobType = project_plan_generation` if async.
- Call AI service `/agents/generate-project-plan`.
- Store result in `project_plans`.
- Set project `planningStatus` to `under_review`.

Response:

```json
{
  "status": "success",
  "data": {
    "planId": "uuid",
    "projectId": "uuid",
    "status": "generated",
    "summary": "Implementation plan generated from approved architecture and UI/UX."
  }
}
```

### Review Project Plan

`PATCH /api/project-plans/:planId/review`

Auth: admin.

Request:

```json
{
  "status": "approved",
  "adminNotes": "Ready to materialize tasks."
}
```

Allowed statuses:

- `approved`
- `changes_requested`

Behavior:

- `approved` sets `approvedBy`, `approvedAt`.
- Do not materialize tasks automatically. Use `/materialize`.

### Materialize Plan

`POST /api/project-plans/:planId/materialize`

Auth: admin.

Behavior:

- Create or update one `project_specs` row for the project.
- Create `project_milestones`.
- Create `project_tasks`.
- Create `project_task_dependencies`.
- Mark plan as current.
- Set project:
  - `status`: `implementation_ready`
  - `planningStatus`: `approved`
  - `planningCompletedAt`: now
  - `implementationReadyAt`: now

Response:

```json
{
  "status": "success",
  "data": {
    "projectId": "uuid",
    "planId": "uuid",
    "milestoneCount": 4,
    "taskCount": 28,
    "dependencyCount": 14,
    "projectStatus": "implementation_ready"
  }
}
```

## AI Service Contracts

AI service base URL comes from backend `AI_SERVICE_URL`.

### Match Freelancers

`POST /agents/match-freelancers`

Owner: Sameh.

Request from NestJS:

```json
{
  "matchingRunId": "uuid",
  "target": {
    "type": "planning_role",
    "roleKey": "architect"
  },
  "project": {
    "id": "uuid",
    "title": "Bakery ecommerce app",
    "description": "Sell bakery products online with stock and sales dashboard.",
    "projectType": "ecommerce",
    "budgetMin": 10000,
    "budgetMax": 30000,
    "currency": "EGP",
    "deadline": "2026-08-20",
    "platforms": ["web", "mobile"]
  },
  "brief": {
    "businessDomain": "bakery",
    "mainGoal": "sell online",
    "targetUsers": "existing bakery customers",
    "coreFeatures": "catalog, checkout, stock, sales dashboard",
    "constraintsPreferences": "warm colors",
    "requiredSkills": ["React", "NestJS", "PostgreSQL"],
    "preferredSkills": ["Stripe", "Redis"],
    "experienceLevel": "mid"
  },
  "filters": {
    "maxHourlyRate": 500,
    "minAvailabilityHours": 10,
    "includeFreelancerIds": [],
    "excludeFreelancerIds": []
  },
  "candidates": [
    {
      "freelancerProfileId": "uuid",
      "userId": "uuid",
      "name": "Aly Example",
      "headline": "Backend Architect",
      "skills": ["NestJS", "PostgreSQL", "System Design"],
      "skillScores": [
        { "skill": "NestJS", "score": 4.6, "confidence": 0.9 },
        { "skill": "System Design", "score": 4.8, "confidence": 0.9 }
      ],
      "availabilityHoursPerWeek": 15,
      "hourlyRate": 350,
      "yearsExperience": 4,
      "assessmentScore": 86,
      "profileSummary": "Detailed AI-generated assessment summary.",
      "embeddingScore": 0.82,
      "activeAssignments": 1,
      "completedProjects": 0
    }
  ]
}
```

Response:

```json
{
  "matchingRunId": "uuid",
  "summary": "Strong candidates available for architecture planning.",
  "candidates": [
    {
      "freelancerProfileId": "uuid",
      "rank": 1,
      "score": 91.5,
      "scoreBreakdown": {
        "skillFit": 35,
        "availabilityFit": 15,
        "experienceFit": 15,
        "budgetFit": 15,
        "projectFit": 10,
        "embeddingFit": 10
      },
      "rationale": "Strong system design and NestJS evidence, rate fits budget, enough weekly availability.",
      "evidence": {
        "matchedSkills": ["NestJS", "PostgreSQL", "System Design"],
        "missingSkills": [],
        "risks": ["Limited weekly hours"],
        "availabilityNotes": "15 hrs/week is enough for planning role",
        "rateNotes": "Within max hourly rate"
      }
    }
  ]
}
```

Rules:

- Return only candidates included in request.
- Scores must be 0 to 100.
- Every candidate must include `rank`, `score`, `scoreBreakdown`, `rationale`, and `evidence`.
- Do not hallucinate skills, years, availability, or rates.
- If not enough candidates, return fewer candidates and explain in `summary`.

### Generate Project Plan

`POST /agents/generate-project-plan`

Owner: Shahd.

Request from NestJS:

```json
{
  "project": {
    "id": "uuid",
    "title": "Bakery ecommerce app",
    "description": "Sell bakery products online with stock and sales dashboard.",
    "budgetMin": 10000,
    "budgetMax": 30000,
    "currency": "EGP",
    "deadline": "2026-08-20",
    "platforms": ["web", "mobile"]
  },
  "brief": {
    "businessDomain": "bakery",
    "mainGoal": "sell online",
    "targetUsers": "existing bakery customers",
    "coreFeatures": "catalog, checkout, stock, sales dashboard",
    "constraintsPreferences": "warm colors",
    "acceptanceCriteria": []
  },
  "architectureSubmission": {
    "id": "uuid",
    "summary": "Architecture summary",
    "content": {}
  },
  "uiuxSubmission": {
    "id": "uuid",
    "summary": "UI/UX summary",
    "content": {}
  },
  "team": [
    {
      "roleKey": "architect",
      "freelancerProfileId": "uuid",
      "availabilityHoursPerWeek": 15
    },
    {
      "roleKey": "ui_ux",
      "freelancerProfileId": "uuid",
      "availabilityHoursPerWeek": 20
    }
  ],
  "options": {
    "sprintLengthDays": 7,
    "targetStartDate": "2026-07-20",
    "targetEndDate": "2026-08-20"
  }
}
```

Response:

```json
{
  "summary": "Implementation plan for a bakery ecommerce web and mobile product.",
  "timeline": {
    "startDate": "2026-07-20",
    "endDate": "2026-08-20",
    "sprints": [
      {
        "name": "Sprint 1",
        "startDate": "2026-07-20",
        "endDate": "2026-07-27",
        "goal": "Foundation and core catalog"
      }
    ]
  },
  "milestones": [
    {
      "title": "Foundation",
      "description": "Auth, project setup, database, deployment setup.",
      "orderIndex": 1,
      "startsAt": "2026-07-20",
      "dueAt": "2026-07-27",
      "budgetAmount": 5000,
      "acceptanceCriteria": ["App shell runs", "Auth works"]
    }
  ],
  "tasks": [
    {
      "clientKey": "task-001",
      "milestoneOrderIndex": 1,
      "title": "Set up NestJS project modules",
      "description": "Create module structure for catalog, orders, stock, and payments.",
      "roleKey": "backend",
      "priority": "high",
      "requiredSkills": ["NestJS", "PostgreSQL"],
      "estimatedHours": 8,
      "orderIndex": 1,
      "dependsOnClientKeys": [],
      "acceptanceCriteria": ["Modules compile", "Basic health check passes"]
    }
  ],
  "projectSpec": {
    "architecture": {},
    "designSystem": {},
    "apiContract": {},
    "dataModel": {},
    "conventions": {}
  },
  "riskRegister": [
    {
      "risk": "Payment complexity",
      "impact": "high",
      "mitigation": "Integrate Stripe escrow early"
    }
  ],
  "acceptanceCriteria": [
    "Customer can browse products",
    "Customer can place order",
    "Admin can track stock and sales"
  ],
  "teamPlan": {
    "recommendedRoles": ["backend", "frontend", "mobile", "qa"],
    "notes": "Implementation team can be matched after plan approval."
  }
}
```

Rules:

- Tasks must be dependency-aware.
- `dependsOnClientKeys` must refer only to task `clientKey` values in the same response.
- Do not produce circular dependencies.
- Use non-overlapping independent work where possible.
- Put implementation details in `projectSpec`, not only in summary text.

### Evaluate Planning Submission

Optional if time allows.

`POST /agents/evaluate-planning-submission`

Response shape:

```json
{
  "qualityScore": 82,
  "recommendation": "approve",
  "missingItems": [],
  "issues": [
    {
      "severity": "medium",
      "message": "Payment webhook handling should be specified."
    }
  ],
  "summary": "Submission is usable with one payment architecture note."
}
```

## Frontend Contract

Owner: Muhanad.

Create or update these service files:

- `src/services/matching.ts`
- `src/services/planning.ts`
- `src/services/payments.ts`
- Reuse shared API client from the existing frontend.

Do not place raw `fetch('/api/...')` calls inside pages if a service file already exists.

### Customer Project Page

Route: existing project detail page, plus planning section.

Show:

- Brief status.
- Planning status.
- Assigned planning team:
  - Architect
  - UI/UX
- Planning deliverables:
  - Architecture submission status
  - UI/UX submission status
- Generated plan status.
- Payment/escrow status.
- Milestones/tasks after plan is materialized.

Customer copy should be simple:

- "Planning team is being matched"
- "Architecture and UI/UX are in progress"
- "Implementation plan is under review"
- "Project is ready for implementation"

### Admin Matching Page

Route: `/dashboard/admin/matching`

Show:

- Filters:
  - Project
  - Role
  - Status
  - Date range
- Table:
  - Project
  - Role
  - Run status
  - Candidate count
  - Completed at
  - Action: `Review`

### Admin Matching Run Detail

Route: `/dashboard/admin/matching/[runId]`

Show:

- Left fixed project summary.
- Right ranked candidate cards/table.
- Candidate info:
  - Name
  - Headline
  - Top skills
  - Skill scores
  - Availability
  - Hourly rate
  - Match score
  - Rationale
  - Risks
- Actions:
  - Shortlist
  - Select
  - Reject
  - Assign role

Use our green primary button style. Keep secondary buttons smaller and aligned.

### Freelancer Assigned Planning Work

Route: `/freelancer/projects` or `/freelancer/projects/assigned`

Show:

- Assigned planning project card.
- Role key (`architect` or `ui_ux`).
- Project brief summary.
- Due date if assigned.
- Submit deliverable button.
- Submission status.

### Freelancer Planning Submission Page

Route: `/freelancer/projects/[projectId]/planning`

Show:

- Project brief on the side.
- Submission form:
  - Title
  - Summary
  - Structured content fields based on role.
  - File URL attachments if needed.
- Save draft if time allows.
- Submit.

### Admin Planning Review

Route: `/dashboard/admin/planning`

Show queues:

- Planning submissions.
- Generated project plans.

Actions:

- Approve submission.
- Request changes.
- Generate plan when architecture and UI/UX are approved.
- Approve plan.
- Materialize tasks.

### Payment UI

Customer project page should show payment state:

- No escrow yet.
- Escrow payment pending.
- Escrow paid.
- Release pending.
- Released.

Buttons:

- `Add payment method`
- `Pay escrow`
- `View payments`

Do not expose Stripe secret keys or account IDs except safe public status text.

## Status Machines

### Project Status

Use existing project status plus Sprint 4 values:

- `brief_complete`
- `planning_matching`
- `planning_assigned`
- `planning_in_progress`
- `planning_review`
- `implementation_ready`
- Later implementation statuses can be added in Sprint 5.

Delete rule:

- Customer can delete before assignment.
- Customer cannot delete once any `project_role_assignments` row exists or project reaches `planning_assigned` or later.

### Project Planning Status

Use `projects.planningStatus`:

- `not_started`
- `matching`
- `assigned`
- `in_progress`
- `under_review`
- `approved`
- `changes_requested`
- `completed`
- `cancelled`

### Matching Run Status

Use `matching_runs.status`:

- `queued`
- `running`
- `completed`
- `failed`
- `reviewed`
- `cancelled`

### Matching Candidate Status

Use `matching_candidates.status`:

- `recommended`
- `shortlisted`
- `selected`
- `rejected`
- `assigned`

### Role Assignment Status

Use `project_role_assignments.status`:

- `recommended`
- `assigned`
- `accepted`
- `declined`
- `in_progress`
- `cancelled`
- `completed`
- `replaced`

Do not use `submitted`, `approved`, or `rejected` for role assignments. Those are planning submission or plan review statuses.

### Planning Submission Status

Use `project_planning_submissions.status`:

- `draft`
- `submitted`
- `approved`
- `changes_requested`
- `rejected`

### Project Plan Status

Use `project_plans.status`:

- `generated`
- `under_review`
- `approved`
- `changes_requested`
- `rejected`
- `superseded`

If AI generation fails, store failure on `agent_jobs`. Do not write `failed` into `project_plans.status` unless a future migration adds it.

### Project Task Status

Use `project_tasks.status`:

- `todo`
- `blocked`
- `in_progress`
- `review`
- `changes_requested`
- `done`
- `cancelled`

### Payment Status

Use `project_payments.status`:

- `requires_payment`
- `processing`
- `succeeded`
- `failed`
- `cancelled`
- `refunded`
- `partially_refunded`

Use UI copy like "Escrow paid" for `succeeded`, but keep the API/DB status as `succeeded`.

Use `escrow_ledger_entries.status`:

- `pending`
- `posted`
- `voided`
- `failed`

## Stripe Backend Contract

Owner: Asaad.

### Customer Setup Intent

`POST /api/payments/customer/setup-intent`

Auth: customer.

Response:

```json
{
  "status": "success",
  "data": {
    "customerId": "cus_xxx",
    "clientSecret": "seti_xxx_secret_xxx"
  }
}
```

Store:

- `users.stripeCustomerId`
- `users.stripeDefaultPaymentMethodId` after webhook or explicit confirm endpoint if added.

### Freelancer Onboarding Link

`POST /api/payments/freelancer/onboarding-link`

Auth: approved freelancer or freelancer in verification flow if we want early onboarding.

Response:

```json
{
  "status": "success",
  "data": {
    "accountId": "acct_xxx",
    "url": "https://connect.stripe.com/setup/..."
  }
}
```

Store on `freelancer_profiles`:

- `stripeAccountId`
- `stripeOnboardingStatus`
- `stripeChargesEnabled`
- `stripePayoutsEnabled`
- `stripeRequirementsDue`
- `stripeOnboardedAt`

### Escrow Intent

`POST /api/projects/:projectId/payments/escrow-intent`

Auth: project customer.

Request:

```json
{
  "amount": 10000,
  "currency": "EGP",
  "milestoneId": null,
  "purpose": "planning_deposit"
}
```

Response:

```json
{
  "status": "success",
  "data": {
    "paymentId": "uuid",
    "stripePaymentIntentId": "pi_xxx",
    "clientSecret": "pi_xxx_secret_xxx",
    "amount": 10000,
    "currency": "EGP",
    "status": "requires_payment"
  }
}
```

Rules:

- Store `project_payments` before returning.
- Webhook updates final status.
- Write `escrow_ledger_entries` only when Stripe confirms success or release.
- Do not trust frontend payment success alone.
- Allowed payment purposes:
  - `planning_deposit`
  - `milestone_funding`
  - `full_project_deposit`
  - `change_request`
  - `refund_adjustment`

### Stripe Webhook

`POST /api/payments/webhooks/stripe`

Rules:

- Must use raw body signature verification.
- Store every webhook in `stripe_webhook_events`.
- Idempotent by `stripeEventId`.
- Handle at minimum:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `account.updated`
  - `setup_intent.succeeded`
- If processing fails, store `processingError`.

## Backend Implementation Notes

### Matching Candidate Pool

The backend should only send eligible candidates to AI:

- User role is freelancer.
- Freelancer verification status is approved.
- Has assessment results and skill scores.
- Has availability hours.
- Not disabled.
- Not already overloaded if active assignment count is known.

Recommended initial filtering:

- Match role skill hints:
  - `architect`: architecture, backend, system design, database, API, DevOps.
  - `ui_ux`: UI/UX, Figma, product design, user flows, frontend design.
- Respect `maxHourlyRate` if provided.
- Respect `minAvailabilityHours` if provided.

AI ranks only the candidates backend sends.

### Embeddings

Use embeddings as one signal, not the only signal.

- `brief_embeddings` represent project/brief intent.
- `freelancer_profile_embeddings` represent freelancer capability.
- If vector similarity is available, send `embeddingScore` to the matching agent.
- If not available, send `embeddingScore: null` and let deterministic scoring use fields.

### Task Materialization

When materializing a project plan:

- Create milestones first.
- Create tasks with a mapping from AI `clientKey` to DB `project_tasks.id`.
- Create dependencies after all tasks exist.
- Validate dependency references before writing.
- Reject circular dependency graphs.
- Keep `project_specs` one row per project and update it from approved plan.

## Frontend Service Contracts

### `src/services/matching.ts`

Must export:

```ts
export async function startPlanningRoleMatching(projectId: string, payload: StartPlanningRoleMatchingPayload): Promise<ApiResponse<StartPlanningRoleMatchingResponse>>;
export async function getProjectMatchingRuns(projectId: string, params?: MatchingRunQuery): Promise<ApiListResponse<MatchingRunSummary>>;
export async function getMatchingRun(runId: string): Promise<ApiResponse<MatchingRunDetail>>;
export async function updateCandidateStatus(candidateId: string, payload: UpdateCandidateStatusPayload): Promise<ApiResponse<MatchingCandidate>>;
export async function reviewMatchingRun(runId: string, payload: ReviewMatchingRunPayload): Promise<ApiResponse<MatchingRunDetail>>;
export async function createRoleAssignment(projectId: string, payload: CreateRoleAssignmentPayload): Promise<ApiResponse<ProjectRoleAssignment>>;
```

### `src/services/planning.ts`

Must export:

```ts
export async function getProjectRoleAssignments(projectId: string): Promise<ApiResponse<ProjectRoleAssignment[]>>;
export async function updateRoleAssignmentStatus(assignmentId: string, payload: UpdateRoleAssignmentStatusPayload): Promise<ApiResponse<ProjectRoleAssignment>>;
export async function submitPlanningDeliverable(projectId: string, payload: PlanningSubmissionPayload): Promise<ApiResponse<ProjectPlanningSubmission>>;
export async function getProjectPlanningSubmissions(projectId: string): Promise<ApiResponse<ProjectPlanningSubmission[]>>;
export async function reviewPlanningSubmission(submissionId: string, payload: ReviewPlanningSubmissionPayload): Promise<ApiResponse<ProjectPlanningSubmission>>;
export async function generateProjectPlan(projectId: string, payload: GenerateProjectPlanPayload): Promise<ApiResponse<ProjectPlan>>;
export async function getProjectPlans(projectId: string): Promise<ApiResponse<ProjectPlan[]>>;
export async function getProjectPlan(planId: string): Promise<ApiResponse<ProjectPlanDetail>>;
export async function reviewProjectPlan(planId: string, payload: ReviewProjectPlanPayload): Promise<ApiResponse<ProjectPlan>>;
export async function materializeProjectPlan(planId: string): Promise<ApiResponse<MaterializedPlanResult>>;
```

### `src/services/payments.ts`

Must export:

```ts
export async function createCustomerSetupIntent(): Promise<ApiResponse<CustomerSetupIntentResponse>>;
export async function createFreelancerOnboardingLink(): Promise<ApiResponse<FreelancerOnboardingLinkResponse>>;
export async function getFreelancerStripeAccount(): Promise<ApiResponse<FreelancerStripeAccountStatus>>;
export async function createEscrowIntent(projectId: string, payload: CreateEscrowIntentPayload): Promise<ApiResponse<EscrowIntentResponse>>;
export async function getProjectPayments(projectId: string): Promise<ApiResponse<ProjectPayment[]>>;
export async function releaseProjectPayment(projectId: string, paymentId: string, payload?: ReleasePaymentPayload): Promise<ApiResponse<ProjectPayment>>;
```

## Environment Variables

Backend:

```bash
AI_SERVICE_URL=http://localhost:8000
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:3001
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CONNECT_RETURN_URL=http://localhost:3001/payments/connect/return
STRIPE_CONNECT_REFRESH_URL=http://localhost:3001/payments/connect/refresh
STRIPE_PLATFORM_FEE_PERCENT=10
```

Frontend:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
```

AI service:

```bash
GEMINI_API_KEY=xxx
AI_MODEL_FAST=gemini-...
AI_MODEL_REASONING=gemini-...
```

## Parallel Work Rules

- Ebrahim defines backend DTOs and route names for matching/planning.
- Muhanad consumes service files only, no invented URLs in page components.
- Sameh implements AI matching response exactly as shown.
- Shahd implements AI scrum master response exactly as shown.
- Asaad owns Stripe route implementation and webhook idempotency.
- If AI cannot produce a valid response, backend stores job failure and frontend shows a pending/retry state.
- Do not delete or rename existing Sprint 3 routes.
- Do not change existing verification or assessment flow while implementing Sprint 4.

## Acceptance Criteria For Demo

The sprint is done when this flow works with real DB data:

1. Customer has a project with completed brief.
2. Admin starts matching for `architect` and `ui_ux`.
3. Backend creates matching runs and stores candidates.
4. Admin reviews candidates and assigns one architect and one UI/UX freelancer.
5. Customer can see the assigned planning team.
6. Assigned freelancers can see the project.
7. Architect submits architecture deliverable.
8. UI/UX submits design deliverable.
9. Admin approves both deliverables.
10. Admin generates scrum master project plan.
11. Backend stores plan, milestones, tasks, dependencies, and project spec.
12. Admin materializes approved plan.
13. Project reaches `implementation_ready`.
14. Customer can see plan/milestones/tasks.
15. Customer can create escrow payment intent.
16. Stripe webhook updates payment status and escrow ledger.

## Test Checklist

Backend:

- `npm run build`
- `npm run lint`
- `npm run db:show`
- `npm run db:migrate`
- Matching run creation with no eligible candidates.
- Matching run creation with eligible candidates.
- Assignment rejects unapproved freelancers.
- Project delete is blocked after assignment.
- Plan materialization rejects circular dependencies.
- Stripe webhook is idempotent.

Frontend:

- No raw FastAPI calls.
- No Stripe secret usage.
- Admin matching review loads from backend.
- Customer project page handles every project planning status.
- Freelancer assigned work page handles no assignments and active assignment.
- Payment UI handles pending, success, failed, and webhook delay.

AI service:

- Matching endpoint returns valid JSON for empty candidate list.
- Matching endpoint returns valid JSON for several candidates.
- Plan endpoint returns valid dependency graph.
- Plan endpoint does not invent DB IDs.
- Plan endpoint uses `clientKey` for dependency references.

## Notes For Sprint 5

Sprint 4 stops at implementation-ready project planning and payment foundation.

Sprint 5 should focus on:

- Matching full implementation team from materialized tasks.
- Freelancer task acceptance and delivery flow.
- Customer task review.
- Milestone release flow.
- Reviews/ratings after completed work.
- RAG improvements for project briefs, freelancer profiles, and historical delivery data.
