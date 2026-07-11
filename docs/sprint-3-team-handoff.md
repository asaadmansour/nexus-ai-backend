# Sprint 3 Team Handoff

Sprint 3 is a demo-first sprint. The goal is to show 60-70% of the product working end to end in two days:

- Customer creates a project.
- Requirements agent collects a usable brief.
- Project reaches `brief_complete`.
- Freelancer completes profile and CV.
- Freelancer starts and submits an AI-generated assessment.
- Admin reviews users, projects, freelancers, assessments, and agent health.
- Notifications and dashboard stats reflect real product activity.

This document uses the real backend route names that exist today, plus clearly marks Sprint 3 routes that still need to be built.

## Current Backend API Map

Global API prefix: `/api`

Already implemented:

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `POST /api/auth/exchange`
- `POST /api/auth/complete-profile`
- `POST /api/auth/resend-verification`
- `POST /api/auth/verify-email`
- `GET /api/users/me`
- `PATCH /api/users/me`
- `POST /api/uploads/profile-image`
- `POST /api/uploads/freelancer-cv`
- `GET /api/freelancers/me`
- `PATCH /api/freelancers/me`
- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:projectId/brief`
- `PATCH /api/projects/:projectId/brief`
- `GET /api/projects/:projectId/brief/messages`
- `POST /api/projects/:projectId/brief/messages`
- `POST /api/projects/:projectId/brief/reopen`
- `POST /api/projects/:projectId/brief/confirm`
- `GET /api/admin/users`
- `GET /api/admin/projects`
- `GET /api/admin/stats`
- `POST /api/ai/extract-cv`
- `POST /api/ai/validate-brief`
- `POST /api/ai/generate-assessment`
- `POST /api/ai/grade-assessment`

Important current Sprint 3 gaps:

- No product-facing freelancer verification route yet.
- No product-facing freelancer assessment routes yet.
- No admin freelancer review route yet.
- No admin assessment review route yet.
- No admin agent overview route yet.
- No notification controller/service routes yet.
- AI gateway still has mock CV extraction, mock assessment generation, and mock grading.
- Queue/worker is not wired yet, even though `agent_jobs` entity exists.
- Frontend has no freelancer assessment pages yet.
- Admin dashboard only reads simple total users and total projects today.
- Frontend notification dropdown is intentionally empty until notification routes are wired.

## Shared API Rules For Sprint 3

All new Sprint 3 backend routes must follow these rules unless the route already exists:

- Use global prefix `/api`.
- Use camelCase request and response fields.
- Return successful product responses as:

```json
{
  "status": "success",
  "data": {}
}
```

- Return paginated responses as:

```json
{
  "status": "success",
  "data": [],
  "total": 25,
  "page": 1,
  "limit": 20
}
```

- Protect customer, freelancer, and admin routes with the existing auth guards.
- Do not let the frontend call the FastAPI AI service directly.
- The frontend calls NestJS only.
- NestJS calls FastAPI through `AI_SERVICE_URL`.
- Never send assessment rubrics, correct answers, hidden scoring fields, or AI internal prompts to the frontend.
- Avoid silent mocks in Sprint 3. If AI is unavailable, return a clear error or show a pending/retry state.

## Sprint 3 Canonical Route Ownership

These route names are final for Sprint 3. Do not create alternate route names in frontend, backend, or AI service. If implementation discovers a required change, update this section first and then update the detailed contract section below.

Frontend service constants must mirror this table exactly. The owner listed here owns the backend route and the matching frontend API constant. Other teammates consume the route through the service file, not by inventing local URLs.

### Ebrahim Routes

Ebrahim owns the assessment vertical routes and their matching frontend assessment service constants.

| Method | Route | Frontend Service | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/freelancer-verification/me` | `src/services/assessments.ts` | Freelancer verification checklist and next action. |
| `POST` | `/api/freelancer-assessments/start` | `src/services/assessments.ts` | Start or reuse an active generated assessment. |
| `GET` | `/api/freelancer-assessments/current` | `src/services/assessments.ts` | Load the active/pending assessment for the logged-in freelancer. |
| `GET` | `/api/freelancer-assessments/:id` | `src/services/assessments.ts` | Load safe assessment detail without rubrics or correct answers. |
| `POST` | `/api/freelancer-assessments/:id/answers` | `src/services/assessments.ts` | Autosave or upsert freelancer answers. |
| `POST` | `/api/freelancer-assessments/:id/events` | `src/services/assessments.ts` | Record assessment session events. |
| `POST` | `/api/freelancer-assessments/:id/submit` | `src/services/assessments.ts` | Submit answers and trigger grading. |
| `GET` | `/api/admin/assessments` | `src/services/admin.ts` | Admin assessment review queue. |
| `GET` | `/api/admin/assessments/:id` | `src/services/admin.ts` | Admin safe review detail. |
| `PATCH` | `/api/admin/assessments/:id/review` | `src/services/admin.ts` | Admin assessment decision. |

### Shahd Routes

Shahd owns the admin operations routes and their matching frontend admin service constants.

| Method | Route | Frontend Service | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/stats` | `src/services/admin.ts` | Admin dashboard totals, trends, and pipeline stats. |
| `GET` | `/api/admin/freelancers` | `src/services/admin.ts` | Admin freelancer queue with filters and pagination. |
| `GET` | `/api/admin/freelancers/:id` | `src/services/admin.ts` | Admin freelancer detail, CV summary, and assessment summary. |
| `PATCH` | `/api/admin/freelancers/:id/verification` | `src/services/admin.ts` | Admin freelancer verification status update. |
| `GET` | `/api/admin/agents/overview` | `src/services/admin.ts` | Agent health overview for dashboard. |
| `GET` | `/api/admin/agent-jobs` | `src/services/admin.ts` | Agent job list with filters and pagination. |
| `GET` | `/api/admin/agent-jobs/:id` | `src/services/admin.ts` | Agent job detail and failure payload. |

### Asaad Routes

Asaad owns queue wiring, notification routes, seeding, and final integration.

| Method | Route | Frontend Service | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/notifications` | `src/services/notifications.ts` | Current user's notification dropdown/list. |
| `PATCH` | `/api/notifications/:id/read` | `src/services/notifications.ts` | Mark one notification as read. |
| `PATCH` | `/api/notifications/read-all` | `src/services/notifications.ts` | Mark all current-user notifications as read. |
| `DELETE` | `/api/notifications/:id` | `src/services/notifications.ts` | Optional notification dismissal if time allows. |

### Muhanad AI Routes

Muhanad owns FastAPI agent behavior. Frontend must not call these routes directly. NestJS owns the public `/api/ai/*` gateway and calls FastAPI through `AI_SERVICE_URL`.

| Service | Method | Route | NestJS Gateway |
| --- | --- | --- | --- |
| FastAPI | `POST` | `/agents/extract-cv` | `POST /api/ai/extract-cv` |
| FastAPI | `POST` | `/agents/generate-assessment` | `POST /api/ai/generate-assessment` |
| FastAPI | `POST` | `/agents/grade-assessment` | `POST /api/ai/grade-assessment` |

## Sprint 3 Dependency Order

First backend unblockers:

- Use the canonical route ownership table above as the source of truth.
- Ebrahim leads the assessment vertical: freelancer verification, assessment routes, assessment submission, and assessment review integration.
- Shahd leads the admin operations vertical: admin stats, freelancer review, agent overview, and admin dashboard integration.
- Muhanad replaces AI gateway mocks with real FastAPI AI routes.

Parallel frontend work:

- Sameh builds assessment UI against the route contracts in this document.
- Ebrahim supports the frontend assessment service/API integration where it touches his backend routes.
- Shahd builds the admin dashboard and owns the frontend/admin-service integration for her backend routes.

Integration owner:

- Asaad wires queue, notifications, final frontend tweaks, seed data, and merges.

Rule:

- If a feature is blocked by a backend route that is not done yet, frontend should build a typed service against the exact contract below and use local mock data only inside that service file. Remove the mock when the route lands.
- Do not invent alternate route names. If the contract needs to change, update this document first.
- Ebrahim and Shahd may both edit NestJS and Next.js files, but route ownership decides who lands the backend route and matching service constant. Non-owners consume through the typed service files.

## Sameh: Frontend Freelancer Assessment UI And Exam Flow

### Responsibility

Build the freelancer verification and assessment experience in the frontend. The UI should feel like a real exam/product workflow, not a placeholder.

Sameh owns frontend only for this sprint:

- Pages
- Components
- Client-side validation
- Timer behavior
- Autosave behavior
- Anti-cheat event capture
- Mobile responsiveness
- Error/loading/empty states

Sameh should not call `/api/ai/*` directly. The frontend talks to the product routes Ebrahim builds.

### 1. Routes to build

Build these frontend routes:

- `/freelancer/verification`
- `/freelancer/assessment`
- `/freelancer/assessment/result`

Optional if time allows:

- `/freelancer/assessment/:id`

If no dynamic route is added, `/freelancer/assessment` can load the current active assessment from the API.

### 2. Frontend services to add

Add a service file:

- `src/services/assessments.ts`

Add endpoint constants in `src/lib/api.ts`:

```ts
freelancerVerification: {
  me: "/freelancer-verification/me",
},
freelancerAssessments: {
  start: "/freelancer-assessments/start",
  current: "/freelancer-assessments/current",
  detail: (id: string) => `/freelancer-assessments/${id}`,
  answers: (id: string) => `/freelancer-assessments/${id}/answers`,
  submit: (id: string) => `/freelancer-assessments/${id}/submit`,
  events: (id: string) => `/freelancer-assessments/${id}/events`,
},
```

### 3. Backend routes Sameh should consume

Sprint 3 planned routes:

- `GET /api/freelancer-verification/me`
- `POST /api/freelancer-assessments/start`
- `GET /api/freelancer-assessments/current`
- `GET /api/freelancer-assessments/:id`
- `POST /api/freelancer-assessments/:id/answers`
- `POST /api/freelancer-assessments/:id/submit`
- `POST /api/freelancer-assessments/:id/events`

### 4. Verification page UX

Route:

- `/freelancer/verification`

Purpose:

- Show the freelancer where they are in the approval flow.
- Tell them the next action clearly.
- Let them continue to the assessment when ready.

Layout:

- Use the existing dashboard shell/sidebar/topbar.
- Main content should be dense, clean, and operational.
- Avoid a marketing hero.
- Use a compact status panel at the top.
- Use checklist rows for profile, email, CV, assessment, admin review.
- Use small icons from `lucide-react`.

Checklist items:

- Email verified
- Profile completed
- CV uploaded
- CV extracted by AI
- Assessment ready
- Assessment submitted
- Admin review

Each item should show:

- Label
- Status badge: `done`, `pending`, `blocked`, or `needs action`
- Short detail text
- Action button when relevant

Primary actions:

- If CV is missing: link to profile/onboarding CV upload.
- If profile is incomplete: link to profile.
- If assessment is ready: button "Start assessment".
- If assessment is in progress: button "Continue assessment".
- If submitted: button "View result".

Expected response from `GET /api/freelancer-verification/me`:

```json
{
  "status": "success",
  "data": {
    "userId": "uuid",
    "profileId": "uuid",
    "verificationStatus": "assessment_pending",
    "profileComplete": true,
    "emailVerified": true,
    "cvUploaded": true,
    "cvExtracted": true,
    "nextAction": "start_assessment",
    "assessment": {
      "id": "uuid",
      "status": "pending",
      "score": null,
      "durationSeconds": 1800,
      "startedAt": null,
      "expiresAt": null,
      "submittedAt": null
    },
    "missing": []
  }
}
```

Allowed `verificationStatus` values:

- `profile_incomplete`
- `email_verification_pending`
- `id_verification_pending`
- `cv_pending`
- `cv_processing`
- `assessment_pending`
- `assessment_in_progress`
- `assessment_submitted`
- `interview_pending`
- `approved`
- `rejected`

Allowed `nextAction` values:

- `complete_profile`
- `verify_email`
- `upload_cv`
- `wait_for_cv_extraction`
- `start_assessment`
- `continue_assessment`
- `wait_for_review`
- `approved`
- `rejected`

### 5. Assessment lobby UX

Route:

- `/freelancer/assessment`

Before the exam starts, show:

- Assessment status.
- Skills that will be assessed.
- Duration.
- Number of questions.
- Fullscreen warning.
- Anti-cheat warning in simple language.
- Start button.

Do not scare the user. The tone should be firm but calm:

- "Please stay on this tab during the assessment."
- "We record focus changes to help reviewers understand the session."

Start button calls:

- `POST /api/freelancer-assessments/start`

Start payload:

```json
{
  "questionCount": 6,
  "durationSeconds": 1800
}
```

Both fields are optional. Backend can default them.

Start response:

```json
{
  "status": "success",
  "data": {
    "assessment": {
      "id": "uuid",
      "status": "in_progress",
      "durationSeconds": 1800,
      "startedAt": "2026-07-11T15:00:00.000Z",
      "expiresAt": "2026-07-11T15:30:00.000Z",
      "submittedAt": null,
      "remainingSeconds": 1800,
      "questionCount": 6
    },
    "questions": [
      {
        "id": "uuid",
        "questionType": "multiple_choice",
        "skill": "React",
        "difficulty": "mid",
        "prompt": "Question text",
        "choices": [
          { "id": "a", "label": "Option A" },
          { "id": "b", "label": "Option B" }
        ],
        "orderIndex": 1
      }
    ],
    "antiCheat": {
      "trackFocusLoss": true,
      "trackCopyPaste": true,
      "requireFullscreen": true
    }
  }
}
```

### 6. Exam screen UX

The exam screen should be the main focus.

Desktop layout:

- Top sticky exam header:
  - Assessment title
  - Timer
  - Question count progress
  - Submit button
- Left or top compact question navigator:
  - Numbered buttons
  - Answered/unanswered visual state
  - Current question visual state
- Main question area:
  - Prompt
  - Answer control
  - Save state
- Right compact session panel if there is enough space:
  - Remaining time
  - Answered count
  - Warnings count

Mobile layout:

- Single column.
- Sticky top timer.
- Question navigator should become horizontal scroll pills.
- Answer input must not overflow.
- Submit button must remain reachable without covering text.

Question types:

- `multiple_choice`: radio list, one choice.
- `short_answer`: textarea, minimum comfortable height.
- `scenario`: larger textarea with enough room for practical explanation.

Answer payload:

```json
{
  "answers": [
    {
      "questionId": "uuid",
      "answer": {
        "value": "User answer"
      }
    }
  ],
  "autosave": true
}
```

For multiple choice:

```json
{
  "answers": [
    {
      "questionId": "uuid",
      "answer": {
        "choiceId": "a"
      }
    }
  ],
  "autosave": true
}
```

Autosave:

- Debounce text answers by around 700ms.
- Save immediately when switching questions.
- Show one of: `Saved`, `Saving`, `Could not save`, `Offline`.
- Do not block typing while saving.
- If autosave fails, keep the local answer and retry on next change.

Timer:

- Calculate remaining time from `expiresAt`, not only local countdown.
- When timer hits zero, call submit automatically.
- Send an event with `eventType: "timer_expired"` before or during auto-submit.

Anti-cheat events:

- On fullscreen exit, send event.
- On tab hidden, send event.
- On focus loss, send event.
- On copy/paste attempts inside answer fields, send event.
- Do not break normal typing.
- Show a small warning banner after focus/fullscreen events.

Event payload:

```json
{
  "eventType": "focus_lost",
  "metadata": {
    "questionId": "uuid",
    "occurredAt": "2026-07-11T15:05:00.000Z"
  }
}
```

Allowed event types:

- `fullscreen_enter`
- `fullscreen_exit`
- `focus_lost`
- `focus_returned`
- `visibility_hidden`
- `visibility_visible`
- `copy_attempt`
- `paste_attempt`
- `timer_expired`
- `manual_submit_click`
- `autosave_failed`

Submit:

- Confirm before manual submit.
- Do not confirm on timer auto-submit.
- Call `POST /api/freelancer-assessments/:id/submit`.
- Redirect to `/freelancer/assessment/result`.

Submit response:

```json
{
  "status": "success",
  "data": {
    "assessment": {
      "id": "uuid",
      "status": "submitted",
      "score": "82.00",
      "submittedAt": "2026-07-11T15:28:00.000Z"
    },
    "result": {
      "recommendation": "pass",
      "feedback": "Good practical coverage. Admin review is still required.",
      "questionResults": [
        {
          "questionId": "uuid",
          "score": 80,
          "feedback": "Clear answer."
        }
      ]
    },
    "nextAction": "wait_for_review"
  }
}
```

### 7. Result page UX

Route:

- `/freelancer/assessment/result`

States:

- No assessment yet: link to verification.
- In progress: link to continue.
- Submitted and waiting for admin: show "Pending review".
- Approved: show approval state.
- Rejected: show rejection reason if available.

Do not show hidden rubric or correct answers.

Show:

- Score if backend returns it.
- Recommendation label.
- Submission time.
- Warning count.
- Friendly next step text.

### Sameh Definition of Done

- `/freelancer/verification` exists and uses `GET /api/freelancer-verification/me`.
- `/freelancer/assessment` exists and can start or continue an assessment.
- `/freelancer/assessment/result` exists and shows submitted/review states.
- Exam UI supports timer, question navigation, autosave, submit, and anti-cheat event capture.
- UI is responsive on mobile and desktop.
- Frontend does not call `/api/ai/*` directly.
- All assessment API calls live in one typed service file.
- Loading, error, empty, blocked, and submitted states are visible and polished.

## Ebrahim: Full-Stack Assessment Vertical And Assessment Review

### Responsibility

Build the assessment workflow end to end across NestJS and the frontend service layer.

Ebrahim owns:

- NestJS freelancer verification controller/service.
- NestJS freelancer assessment controller/service.
- NestJS admin assessment review routes.
- Assessment DTOs, validation, persistence, and guards.
- Frontend assessment service contracts in `src/services/assessments.ts`.
- Frontend API constants for the assessment routes he adds.
- Integration support for Sameh's assessment UI.
- Integration support for Shahd where admin assessment review touches her dashboard.

Ebrahim does not own the whole admin dashboard. He owns the assessment data and review actions that the admin dashboard consumes.

Ebrahim should not implement FastAPI LLM logic. Call the existing NestJS `AiService` methods and let Muhanad replace the AI internals.

### 1. Files to add or update

Backend files:

- `src/freelancers/freelancer-verification.controller.ts`
- `src/freelancers/freelancer-assessments.controller.ts`
- `src/freelancers/freelancer-assessments.service.ts`
- `src/freelancers/dtos/start-assessment.dto.ts`
- `src/freelancers/dtos/save-assessment-answers.dto.ts`
- `src/freelancers/dtos/track-assessment-event.dto.ts`
- `src/admin/dtos/review-assessment.dto.ts`
- Admin assessment review controller/service methods in `AdminModule`

Frontend files:

- `src/services/assessments.ts`
- Assessment route constants in `src/lib/api.ts`
- Shared assessment response types if needed in `src/types/project.ts` or a new `src/types/assessment.ts`

Wire them into existing modules:

- `FreelancersModule`
- `AdminModule`
- `AgentsModule` if `AiService` must be injected.

Coordinate with Sameh before changing frontend assessment response shapes.
Coordinate with Shahd before changing admin assessment review response shapes.

### 2. Assessment statuses

Use these assessment status values:

- `pending`
- `in_progress`
- `submitted`
- `graded`
- `needs_review`
- `passed`
- `failed`
- `expired`
- `cancelled`

Use these freelancer verification status values:

- `profile_incomplete`
- `email_verification_pending`
- `id_verification_pending`
- `cv_pending`
- `cv_processing`
- `assessment_pending`
- `assessment_in_progress`
- `assessment_submitted`
- `interview_pending`
- `approved`
- `rejected`

Do not create another naming system.

### 3. Freelancer verification route

Route:

- `GET /api/freelancer-verification/me`

Guards:

- Auth required.
- Verified email required if current backend convention allows it.
- Role: `freelancer`.

Behavior:

- Load current user and freelancer profile.
- Calculate missing profile pieces.
- Load latest assessment for this freelancer.
- Return the next action for the frontend.

Response:

```json
{
  "status": "success",
  "data": {
    "userId": "uuid",
    "profileId": "uuid",
    "verificationStatus": "assessment_pending",
    "profileComplete": true,
    "emailVerified": true,
    "cvUploaded": true,
    "cvExtracted": true,
    "nextAction": "start_assessment",
    "assessment": {
      "id": "uuid",
      "status": "pending",
      "score": null,
      "durationSeconds": 1800,
      "startedAt": null,
      "expiresAt": null,
      "submittedAt": null
    },
    "missing": []
  }
}
```

Profile is complete when:

- `headline` exists.
- `bio` exists.
- `skills` has at least one item.
- `yearsExperience` is not null.
- `hourlyRate` is not null.
- `cvUrl` exists.

### 4. Start assessment

Route:

- `POST /api/freelancer-assessments/start`

Guards:

- Auth required.
- Verified email required.
- Role: `freelancer`.

Payload:

```json
{
  "questionCount": 6,
  "durationSeconds": 1800
}
```

Both fields are optional. Defaults:

- `questionCount`: `6`
- `durationSeconds`: `1800`

Behavior:

- Load freelancer profile.
- Reject if profile is missing.
- Reject if CV is missing.
- If an `in_progress` assessment exists and is not expired, return it instead of creating a duplicate.
- If the latest assessment is already `submitted`, return `409 Conflict` with a useful message.
- Call `AiService.generateAssessment`.
- Create one `freelancer_assessments` row.
- Create related `freelancer_assessment_questions` rows.
- Store question rubrics in DB only.
- Do not return rubrics to frontend.
- Set `startedAt` and `expiresAt`.
- Set profile `verificationStatus` to `assessment_in_progress`.

Response:

```json
{
  "status": "success",
  "data": {
    "assessment": {
      "id": "uuid",
      "status": "in_progress",
      "durationSeconds": 1800,
      "startedAt": "2026-07-11T15:00:00.000Z",
      "expiresAt": "2026-07-11T15:30:00.000Z",
      "submittedAt": null,
      "remainingSeconds": 1800,
      "questionCount": 6
    },
    "questions": [
      {
        "id": "uuid",
        "questionType": "short_answer",
        "skill": "React",
        "difficulty": "mid",
        "prompt": "Question text",
        "choices": null,
        "orderIndex": 1
      }
    ],
    "antiCheat": {
      "trackFocusLoss": true,
      "trackCopyPaste": true,
      "requireFullscreen": true
    }
  }
}
```

### 5. Get current assessment

Route:

- `GET /api/freelancer-assessments/current`

Behavior:

- Return the active assessment if it exists.
- Return latest submitted assessment if there is no active one.
- Return `assessment: null` if none exists.
- Include saved answers for the current freelancer.
- Never return rubrics.

Response:

```json
{
  "status": "success",
  "data": {
    "assessment": {
      "id": "uuid",
      "status": "in_progress",
      "durationSeconds": 1800,
      "startedAt": "2026-07-11T15:00:00.000Z",
      "expiresAt": "2026-07-11T15:30:00.000Z",
      "submittedAt": null,
      "remainingSeconds": 1200,
      "score": null
    },
    "questions": [],
    "answers": [
      {
        "questionId": "uuid",
        "answer": {
          "value": "Saved answer"
        },
        "updatedAt": "2026-07-11T15:03:00.000Z"
      }
    ],
    "eventsSummary": {
      "total": 2,
      "focusLost": 1,
      "fullscreenExit": 1
    },
    "nextAction": "continue_assessment"
  }
}
```

### 6. Get assessment by id

Route:

- `GET /api/freelancer-assessments/:id`

Behavior:

- Freelancer can only read their own assessment.
- Admins should use admin routes instead.
- Return same shape as `current`.

### 7. Save answers

Route:

- `POST /api/freelancer-assessments/:id/answers`

Payload:

```json
{
  "answers": [
    {
      "questionId": "uuid",
      "answer": {
        "value": "My answer"
      }
    }
  ],
  "autosave": true
}
```

Behavior:

- Assessment must belong to current freelancer.
- Assessment must be `in_progress`.
- Reject if submitted.
- Reject if assessment expired, unless frontend is doing final submit.
- Upsert each answer by `assessmentId` and `questionId`.
- If possible, add a DB unique constraint on `(assessment_id, question_id)`.
- Return saved answer rows.

Response:

```json
{
  "status": "success",
  "data": {
    "answers": [
      {
        "questionId": "uuid",
        "answer": {
          "value": "My answer"
        },
        "updatedAt": "2026-07-11T15:04:00.000Z"
      }
    ]
  }
}
```

### 8. Track assessment events

Route:

- `POST /api/freelancer-assessments/:id/events`

Payload:

```json
{
  "eventType": "focus_lost",
  "metadata": {
    "questionId": "uuid",
    "occurredAt": "2026-07-11T15:05:00.000Z"
  }
}
```

Behavior:

- Assessment must belong to current freelancer.
- Store event in `freelancer_assessment_events`.
- Never fail the exam automatically in Sprint 3.
- Admin review should see event counts.

Response:

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "eventType": "focus_lost",
    "createdAt": "2026-07-11T15:05:00.000Z"
  }
}
```

### 9. Submit assessment

Route:

- `POST /api/freelancer-assessments/:id/submit`

Payload:

```json
{
  "finalAnswers": [
    {
      "questionId": "uuid",
      "answer": {
        "value": "Final answer"
      }
    }
  ],
  "reason": "manual_submit"
}
```

`finalAnswers` is optional. If provided, save them before grading.

Allowed `reason` values:

- `manual_submit`
- `timer_expired`

Behavior:

- Assessment must belong to current freelancer.
- If already submitted, return current submitted result.
- Save final answers if provided.
- Call `AiService.gradeAssessment`.
- Store assessment `score`, `aiFeedback`, `submittedAt`, and status.
- Store per-answer score and feedback when returned.
- Set profile:
  - `verificationStatus`: `assessment_submitted`
  - `assessmentScore`
  - `assessmentSubmittedAt`
- Create a notification for the freelancer.
- Create or expose admin review state.

Response:

```json
{
  "status": "success",
  "data": {
    "assessment": {
      "id": "uuid",
      "status": "submitted",
      "score": "82.00",
      "submittedAt": "2026-07-11T15:28:00.000Z"
    },
    "result": {
      "recommendation": "pass",
      "feedback": "Good practical coverage. Admin review is still required.",
      "questionResults": [
        {
          "questionId": "uuid",
          "score": 80,
          "feedback": "Clear answer."
        }
      ]
    },
    "nextAction": "wait_for_review"
  }
}
```

### 10. Admin stats expansion

Owner:

- Shahd owns the backend implementation and frontend dashboard consumption for this route.
- Ebrahim should only touch this response if assessment counts need a field added.

Existing route:

- `GET /api/admin/stats`

Expand response to:

```json
{
  "status": "success",
  "data": {
    "users": {
      "total": 100,
      "customers": 60,
      "freelancers": 35,
      "admins": 5,
      "emailVerified": 80,
      "emailPending": 20
    },
    "projects": {
      "total": 30,
      "draft": 10,
      "briefComplete": 8,
      "assigned": 4,
      "active": 5,
      "completed": 3
    },
    "freelancers": {
      "total": 35,
      "profileIncomplete": 5,
      "cvPending": 4,
      "assessmentPending": 6,
      "assessmentInProgress": 2,
      "assessmentSubmitted": 8,
      "approved": 7,
      "rejected": 3
    },
    "assessments": {
      "total": 18,
      "inProgress": 2,
      "submitted": 8,
      "passed": 4,
      "failed": 1,
      "needsReview": 3
    },
    "agents": {
      "queued": 4,
      "running": 1,
      "completedToday": 12,
      "failedToday": 2,
      "healthy": 3,
      "failing": 1
    }
  }
}
```

Frontend must not depend on the old `totalUsers` and `totalProjects` only after Sprint 3.

### 11. Admin freelancer routes

Owner:

- Shahd owns these backend routes and the frontend queue/detail UI.
- Ebrahim should coordinate if assessment summary fields need to be included.

Routes:

- `GET /api/admin/freelancers?page=1&limit=20&status=assessment_submitted`
- `GET /api/admin/freelancers/:id`
- `PATCH /api/admin/freelancers/:id/verification`

List response:

```json
{
  "status": "success",
  "data": [
    {
      "id": "profile-uuid",
      "userId": "user-uuid",
      "name": "Mina Nabil",
      "email": "mina@example.com",
      "headline": "Frontend developer",
      "skills": ["React", "TypeScript"],
      "yearsExperience": 2,
      "cvUrl": "https://...",
      "verificationStatus": "assessment_submitted",
      "assessmentScore": "82.00",
      "assessmentSubmittedAt": "2026-07-11T15:28:00.000Z",
      "createdAt": "2026-07-11T14:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

Detail response should include:

- Freelancer profile.
- Safe user fields.
- Latest assessment summary.
- Assessment questions and answers.
- Event counts.
- CV extracted summary if available.

Verification update payload:

```json
{
  "status": "approved",
  "reason": "Strong assessment and clean session."
}
```

Allowed admin update statuses:

- `interview_pending`
- `approved`
- `rejected`

Behavior:

- Update `freelancer_profiles.verificationStatus`.
- Set `approvedAt` when approved.
- Set `rejectedAt` and `rejectionReason` when rejected.
- Create notification for freelancer.

### 12. Admin assessment routes

Owner:

- Ebrahim owns these backend routes.
- Shahd owns the frontend review queue/detail UI that consumes them.
- Any response shape change must update the canonical route section and this detailed contract before implementation.

Routes:

- `GET /api/admin/assessments?page=1&limit=20&status=submitted`
- `GET /api/admin/assessments/:id`
- `PATCH /api/admin/assessments/:id/review`

Review payload:

```json
{
  "decision": "pass",
  "notes": "Approved for interview.",
  "scoreOverride": 85
}
```

Allowed `decision` values:

- `pass`
- `fail`
- `needs_review`

Behavior:

- Update assessment status to `passed`, `failed`, or `needs_review`.
- If `scoreOverride` exists, update assessment score.
- If passed, set freelancer `verificationStatus` to `interview_pending` or `approved`.
- If failed, set freelancer `verificationStatus` to `rejected` and store reason.
- Create notification for freelancer.

### 13. Admin agent overview routes

Owner:

- Shahd owns these backend routes and the frontend agents overview UI.
- Asaad wires queue/job production; Shahd reads from `agent_jobs`.

Routes:

- `GET /api/admin/agents/overview`
- `GET /api/admin/agent-jobs?page=1&limit=20&status=failed&jobType=validate_brief`
- `GET /api/admin/agent-jobs/:id`

Overview response:

```json
{
  "status": "success",
  "data": {
    "agents": [
      {
        "name": "requirements",
        "status": "healthy",
        "queued": 1,
        "running": 0,
        "completedToday": 8,
        "failedToday": 0,
        "lastSuccessAt": "2026-07-11T15:20:00.000Z",
        "lastFailureAt": null
      },
      {
        "name": "assessment",
        "status": "failing",
        "queued": 2,
        "running": 0,
        "completedToday": 3,
        "failedToday": 2,
        "lastSuccessAt": "2026-07-11T13:20:00.000Z",
        "lastFailureAt": "2026-07-11T15:21:00.000Z"
      }
    ],
    "totals": {
      "queued": 3,
      "running": 0,
      "completedToday": 11,
      "failedToday": 2
    }
  }
}
```

Use `agent_jobs` table as the source of truth.

### Ebrahim Definition of Done

- Assessment product routes exist and are guarded.
- Assessment start calls `AiService.generateAssessment`.
- Submit calls `AiService.gradeAssessment`.
- Rubrics are saved but never returned to frontend.
- Answers are saved/upserted.
- Events are tracked.
- Admin assessment list/detail/review routes exist.
- Frontend assessment service exists and matches the backend routes.
- Admin assessment review contract is ready for Shahd's dashboard.
- New routes use `{ status, data }` response shape.
- Backend build passes.

## Shahd: Full-Stack Admin Operations, Reviews UI, And Agents Overview

### Responsibility

Build the admin operations experience across NestJS and frontend so the demo shows real platform control.

Shahd owns:

- NestJS admin stats expansion.
- NestJS admin freelancer list/detail/verification routes.
- NestJS admin agent overview and agent-job read routes.
- Frontend admin stats dashboard.
- Frontend users/projects overview improvements.
- Frontend freelancer verification queue.
- Frontend assessment review queue UI that consumes Ebrahim's assessment review routes.
- Frontend agents overview showing healthy/failing agents.
- Admin service integration in `src/services/admin.ts`.
- Admin API constants in `src/lib/api.ts`.
- Loading, error, empty, success, and mobile states.

Shahd does not own freelancer assessment submission or grading persistence. That belongs to Ebrahim. Shahd consumes assessment review data through the admin routes.

Shahd should coordinate with Asaad before changing queue/agent-job semantics, because Asaad owns queue wiring.

### 1. Existing route to improve

Current page:

- `/dashboard/admin`

Keep this route and make it the admin command center.

### 2. Frontend services to add or expand

Expand:

- `src/services/admin.ts`

Add endpoint constants in `src/lib/api.ts`:

```ts
admin: {
  users: "/admin/users",
  projects: "/admin/projects",
  stats: "/admin/stats",
  freelancers: "/admin/freelancers",
  freelancerDetail: (id: string) => `/admin/freelancers/${id}`,
  freelancerVerification: (id: string) => `/admin/freelancers/${id}/verification`,
  assessments: "/admin/assessments",
  assessmentDetail: (id: string) => `/admin/assessments/${id}`,
  assessmentReview: (id: string) => `/admin/assessments/${id}/review`,
  agentsOverview: "/admin/agents/overview",
  agentJobs: "/admin/agent-jobs",
  agentJobDetail: (id: string) => `/admin/agent-jobs/${id}`,
}
```

If Shahd needs backend routes before frontend integration:

- Add or expand `src/admin/admin.controller.ts`.
- Add or expand `src/admin/admin.service.ts`.
- Add DTOs under `src/admin/dtos`.
- Keep response shapes exactly aligned with the canonical route ownership section and the detailed contracts above.

### 3. Admin dashboard layout

Desktop layout:

- Top row: key stat cards.
- Middle row: project and freelancer pipeline panels.
- Bottom row: agent health and recent activity.
- Use compact tables for queues.
- Do not use huge hero sections.

Mobile layout:

- Stat cards in one column.
- Tables become stacked rows.
- Actions remain easy to tap.

Visual style:

- Quiet admin UI.
- Clear status badges.
- Icons inside action buttons.
- Keep buttons contained and consistent.
- Avoid oversized cards and nested cards.

### 4. Stats to show

Use:

- `GET /api/admin/stats`

Show stat cards:

- Total users
- Customers
- Freelancers
- Total projects
- Brief complete projects
- Active projects
- Assessment submitted
- Approved freelancers
- Failed agent jobs today

Show mini pipeline:

- Projects by status.
- Freelancers by verification status.
- Assessments by status.
- Agents by health.

### 5. Freelancer verification queue

Use:

- `GET /api/admin/freelancers?status=assessment_submitted`
- `GET /api/admin/freelancers/:id`
- `PATCH /api/admin/freelancers/:id/verification`

UI:

- Queue table with name, email, headline, skills, score, status, submitted time.
- Detail drawer or detail section.
- CV link.
- Extracted CV summary.
- Assessment score.
- Warnings count.
- Approve, reject, or move to interview.

Review actions:

- Approve
- Reject
- Mark interview pending

Reject action must ask for a reason.

Payload:

```json
{
  "status": "rejected",
  "reason": "Assessment answers were too weak for approval."
}
```

### 6. Assessment review queue

Use:

- `GET /api/admin/assessments?status=submitted`
- `GET /api/admin/assessments/:id`
- `PATCH /api/admin/assessments/:id/review`

UI:

- Table of submitted assessments.
- Score and recommendation.
- Warning count.
- Started/submitted timestamps.
- Detail view with questions and answers.
- Per-question feedback if available.
- Decision buttons: Pass, Needs review, Fail.

Review payload:

```json
{
  "decision": "needs_review",
  "notes": "Good technical answer, but focus-loss warnings need human review."
}
```

### 7. Agents overview

Use:

- `GET /api/admin/agents/overview`
- `GET /api/admin/agent-jobs?status=failed`
- `GET /api/admin/agent-jobs/:id`

UI:

- Agent health cards:
  - Requirements agent
  - CV extraction agent
  - Assessment generation agent
  - Assessment grading agent
  - Matching agent if available later
- Each card shows:
  - Health status: `healthy`, `degraded`, or `failing`
  - Queued jobs
  - Running jobs
  - Completed today
  - Failed today
  - Last success
  - Last failure
- Failed jobs table:
  - Job type
  - Agent name
  - Related project or brief
  - Attempts
  - Error preview
  - Created time

Do not expose API keys or full sensitive prompts.

### Shahd Definition of Done

- Admin stats backend response includes users, projects, freelancers, assessments, and agents.
- Admin freelancer list/detail/verification backend routes exist.
- Admin agent overview/job list/detail backend routes exist.
- Admin dashboard reads expanded `GET /api/admin/stats`.
- Admin dashboard shows users, projects, freelancers, assessments, and agents.
- Freelancer verification queue UI exists.
- Assessment review queue UI exists.
- Agent overview UI exists.
- Admin action buttons call the backend routes.
- UI handles loading, empty, error, and success states.
- Mobile layout is usable.
- No hardcoded dashboard numbers remain except temporary service mocks while backend routes are still pending.

## Muhanad: AI CV Extraction, Exam Generation, And Evaluation

### Responsibility

Make the AI service real for freelancer assessment.

Muhanad owns:

- FastAPI CV extraction route.
- FastAPI assessment generation route.
- FastAPI assessment grading route.
- NestJS `AiService` integration for those routes.
- Strong JSON response contracts.
- Friendly failures when the AI service cannot produce valid output.

Muhanad does not own frontend UI or NestJS assessment persistence.

### 1. Current AI state

Already working:

- FastAPI requirements agent route: `POST /agents/validate-brief`
- NestJS gateway route: `POST /api/ai/validate-brief`

Still mock in NestJS today:

- `POST /api/ai/extract-cv`
- `POST /api/ai/generate-assessment`
- `POST /api/ai/grade-assessment`

Sprint 3 goal:

- Keep NestJS route names unchanged.
- Replace the mock implementations with calls to FastAPI.

### 2. FastAPI routes to add

Add these routes in `/home/asaad/nexus-ai-service`:

- `POST /agents/extract-cv`
- `POST /agents/generate-assessment`
- `POST /agents/grade-assessment`

NestJS should call these through `AI_SERVICE_URL`.

### 3. CV extraction contract

NestJS route:

- `POST /api/ai/extract-cv`

NestJS payload:

```json
{
  "cvUrl": "https://res.cloudinary.com/.../cv.pdf"
}
```

FastAPI payload should match:

```json
{
  "cvUrl": "https://res.cloudinary.com/.../cv.pdf"
}
```

AI response:

```json
{
  "cvUrl": "https://res.cloudinary.com/.../cv.pdf",
  "headline": "Full-stack developer",
  "skills": ["React", "NestJS", "PostgreSQL"],
  "yearsExperience": 2,
  "summary": {
    "education": "Computer science student",
    "experience": "Built dashboards and APIs",
    "projects": ["E-commerce dashboard"],
    "strengths": ["Frontend", "API integration"]
  },
  "confidence": 0.82,
  "source": "llm"
}
```

Rules:

- Extract only what is supported by the CV text.
- If CV cannot be read, return a structured error.
- Do not invent years of experience.
- If years are unclear, return `yearsExperience: null`.
- Skills should be normalized strings.

### 4. Assessment generation contract

NestJS route:

- `POST /api/ai/generate-assessment`

Payload from Ebrahim backend:

```json
{
  "cvUrl": "https://...",
  "skills": ["React", "TypeScript", "NestJS"],
  "yearsExperience": 2,
  "headline": "Frontend developer",
  "questionCount": 6,
  "durationSeconds": 1800
}
```

AI response:

```json
{
  "durationSeconds": 1800,
  "questions": [
    {
      "questionType": "multiple_choice",
      "skill": "React",
      "difficulty": "mid",
      "prompt": "Which React hook is best for memoizing a computed value?",
      "choices": [
        { "id": "a", "label": "useMemo" },
        { "id": "b", "label": "useEffect" },
        { "id": "c", "label": "useRef" },
        { "id": "d", "label": "useReducer" }
      ],
      "rubric": {
        "correctChoiceId": "a",
        "maxScore": 100,
        "gradingNotes": "useMemo memoizes computed values."
      },
      "orderIndex": 1
    }
  ]
}
```

Allowed question types:

- `multiple_choice`
- `short_answer`
- `scenario`

Rules:

- Generate a balanced exam using the provided skills.
- Avoid asking impossible questions for the claimed experience level.
- Include at least one practical scenario when `questionCount >= 4`.
- Each question must have a rubric.
- Rubric is for backend/admin only and must not be returned to freelancer UI.
- If the model returns invalid JSON, retry once with a repair prompt.
- If still invalid, return a clear error to NestJS.

### 5. Assessment grading contract

NestJS route:

- `POST /api/ai/grade-assessment`

Payload:

```json
{
  "assessmentId": "uuid",
  "answers": [
    {
      "questionId": "uuid",
      "answer": {
        "value": "User answer"
      },
      "question": {
        "questionType": "short_answer",
        "skill": "React",
        "difficulty": "mid",
        "prompt": "Question text",
        "choices": null,
        "rubric": {
          "maxScore": 100,
          "gradingNotes": "Expected details"
        }
      }
    }
  ]
}
```

If current NestJS DTO does not include `question`, update the DTO so Ebrahim can send question and rubric context to the AI safely from the backend.

AI response:

```json
{
  "assessmentId": "uuid",
  "score": 82,
  "maxScore": 100,
  "recommendation": "pass",
  "feedback": "Strong practical understanding with minor gaps.",
  "questionResults": [
    {
      "questionId": "uuid",
      "score": 80,
      "feedback": "Clear answer with enough implementation detail."
    }
  ]
}
```

Allowed recommendations:

- `pass`
- `needs_review`
- `fail`

Rules:

- Grade based on rubric and answer only.
- Do not punish grammar unless it blocks understanding.
- Keep feedback short and useful.
- If answer is empty, score it low and say why.
- If anti-cheat event data is later included, mention it as review context, not automatic failure.

### 6. NestJS `AiService` integration

Update:

- `src/agents/ai.service.ts`

Keep public methods:

- `extractCv`
- `generateAssessment`
- `gradeAssessment`

Change internals:

- Remove mock return values for these three methods.
- Call FastAPI routes with timeout.
- Use the existing `AI_SERVICE_URL`.
- Use `AI_SERVICE_TIMEOUT_MS`.
- Throw `BadGatewayException` on AI failure.
- Log safe error messages only.

Do not break:

- Existing `validateBrief` behavior.

### Muhanad Definition of Done

- FastAPI exposes `POST /agents/extract-cv`.
- FastAPI exposes `POST /agents/generate-assessment`.
- FastAPI exposes `POST /agents/grade-assessment`.
- NestJS AI gateway calls the real FastAPI routes.
- No mock CV, exam, or grading result remains in normal mode.
- AI responses match the contracts above.
- Invalid AI output is handled gracefully.
- Backend can start an assessment and receive real AI-generated questions.
- Backend can submit an assessment and receive real AI grading.

## Asaad: Queue, Notifications, Frontend Tweaks, Seeding, And Merge

### Responsibility

Make Sprint 3 feel like one product instead of separate parts.

Asaad owns:

- Queue/worker wiring.
- Notifications API and frontend dropdown integration.
- Final frontend polish/tweaks.
- Seed data for demo.
- Merge coordination.
- End-to-end demo verification.

### 1. Queue and agent jobs

Current entity exists:

- `src/agents/entities/agent-job.entity.ts`

Use `agent_jobs` as the source of truth for admin agent overview.

Minimum viable queue:

- Create jobs in DB with status `queued`.
- Worker claims queued jobs.
- Worker sets status `running`.
- Worker calls the proper service.
- Worker sets status `completed` with output or `failed` with error.
- Track `attempts`, `startedAt`, `completedAt`, `failedAt`.

Recommended job types:

- `validate_brief`
- `extract_cv`
- `generate_assessment`
- `grade_assessment`
- `match_task`
- `evaluate_submission`

Recommended agent names:

- `requirements`
- `cv_extraction`
- `assessment_generation`
- `assessment_grading`
- `matching`
- `evaluation`

Scripts to add if possible:

```json
{
  "worker:agents": "nest start --entryFile agents-worker",
  "start:all:dev": "document the three terminals: backend, frontend, ai"
}
```

If a separate Nest entry file is too much for two days, make a simple worker command and document exactly how to run it. Do not block the demo on perfect worker architecture.

Admin routes should read job data from `agent_jobs`:

- `GET /api/admin/agents/overview`
- `GET /api/admin/agent-jobs`
- `GET /api/admin/agent-jobs/:id`

### 2. Notifications backend

Current entity exists:

- `src/notifications/entities/notification.entity.ts`

Routes to add:

- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

Optional if time allows:

- `DELETE /api/notifications/:id`

List response:

```json
{
  "status": "success",
  "data": [
    {
      "id": "uuid",
      "title": "Assessment submitted",
      "body": "Your assessment was submitted and is waiting for admin review.",
      "projectId": null,
      "taskId": null,
      "isRead": false,
      "createdAt": "2026-07-11T15:28:00.000Z",
      "readAt": null
    }
  ],
  "unreadCount": 1
}
```

Mark read response:

```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "isRead": true,
    "readAt": "2026-07-11T15:30:00.000Z"
  }
}
```

Create notifications for:

- Project created.
- Brief completed.
- CV uploaded.
- CV extraction completed or failed.
- Assessment started.
- Assessment submitted.
- Admin approved/rejected freelancer.
- Agent job failed when admin should know.

### 3. Notifications frontend

Current frontend file:

- `src/services/notifications.ts`

Replace placeholder data with real API calls:

- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

Topbar should show:

- Unread count.
- Dropdown with latest notifications.
- Mark all read action.
- Empty state.
- Error state that does not crash the app.

### 4. Frontend tweaks and integration

Review these existing frontend areas:

- Requirements chat page.
- Project list/detail.
- Profile page.
- Sidebar user block.
- Topbar notification/search layout.
- Mobile dashboard shell.
- Admin dashboard after Shahd's changes.
- Assessment pages after Sameh's changes.

Fix only product-breaking or demo-visible issues:

- Buttons too large or not contained.
- Text overflow.
- Mobile horizontal overflow.
- Loading states missing.
- Error messages unclear.
- Static placeholder data still visible where backend exists.
- Messages not showing optimistically.

Do not do unrelated redesigns.

### 5. Demo seed data

Add seed script or documented command for:

- Admin user.
- Customer user.
- Freelancer user.
- One project in `brief_complete`.
- One incomplete project.
- One freelancer with CV/profile complete.
- One submitted assessment.
- A few notifications.
- A few agent jobs:
  - one completed requirements job
  - one completed assessment job
  - one failed assessment job

Suggested script name:

```json
{
  "db:seed:demo": "ts-node -r tsconfig-paths/register src/database/seeds/demo.seed.ts"
}
```

If a full seed script is too much, create a documented SQL or TypeScript seed file that can be run once before the presentation.

### 6. Merge and final verification

Before final demo:

- Run backend build.
- Run frontend lint/build.
- Run AI service syntax check or startup.
- Test signup/login.
- Test project create.
- Test requirements chat.
- Test freelancer profile/CV upload.
- Test assessment start.
- Test answer autosave.
- Test assessment submit.
- Test admin dashboard.
- Test notifications dropdown.

Environment variables to verify:

- Backend:
  - `FRONTEND_URL`
  - `AI_SERVICE_URL`
  - `AI_SERVICE_TIMEOUT_MS`
  - database variables
  - Cloudinary variables
  - Redis variables if queue uses Redis
- Frontend:
  - `NEXT_PUBLIC_API_URL`
- AI service:
  - Gemini API key
  - Gemini model variables

### Asaad Definition of Done

- Queue/agent job flow is usable for demo or documented fallback exists.
- Notifications backend routes exist.
- Frontend notifications use real backend data.
- Demo seed data exists.
- Sprint 3 branches are merged without route conflicts.
- End-to-end demo path works.
- No AI service, backend, or frontend process assumptions are left undocumented.

## Cross-Team Contracts

### Assessment frontend must never receive these fields

- `rubric`
- `correctChoiceId`
- hidden grading notes
- prompt templates
- API keys
- raw model responses unless cleaned

Admin detail pages can receive rubric-adjacent review feedback only if it is safe and useful. Prefer cleaned `feedback`, `score`, and `questionResults`.

### Frontend Must Use These Route Owners

- Sameh consumes assessment product routes from Ebrahim.
- Shahd consumes admin stats, freelancer review, and agent routes from her own admin operations backend work.
- Shahd consumes admin assessment review routes from Ebrahim.
- Frontend notifications consume Asaad's notifications routes.
- No frontend feature consumes Muhanad's FastAPI routes directly.

### Backend should use these AI owners

- Ebrahim calls NestJS `AiService`.
- Asaad queue calls NestJS services.
- Muhanad owns FastAPI agent behavior and response contracts.
- No product route should duplicate AI prompts or parsing logic in controllers.

### Status naming source of truth

Project statuses:

- `draft`
- `in_progress`
- `brief_complete`
- `spec_in_progress`
- `spec_under_review`
- `spec_complete`
- `scoped`
- `assigned`
- `active`
- `under_review`
- `completed`
- `cancelled`
- `disputed`

Freelancer verification statuses:

- `profile_incomplete`
- `email_verification_pending`
- `id_verification_pending`
- `cv_pending`
- `cv_processing`
- `assessment_pending`
- `assessment_in_progress`
- `assessment_submitted`
- `interview_pending`
- `approved`
- `rejected`

Assessment statuses:

- `pending`
- `in_progress`
- `submitted`
- `graded`
- `needs_review`
- `passed`
- `failed`
- `expired`
- `cancelled`

Agent job statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

## Final Sprint 3 Demo Script

Use this script to decide whether Sprint 3 is good enough:

1. Login as customer.
2. Create a project with budget and deadline.
3. Open requirements agent.
4. Send one messy natural-language answer.
5. AI extracts fields and asks helpful follow-up.
6. Complete the brief.
7. Project status becomes `brief_complete`.
8. Login as freelancer.
9. Complete profile and upload CV.
10. Start AI-generated assessment.
11. Answer at least two questions.
12. Trigger one focus-loss event.
13. Submit assessment.
14. Login as admin.
15. View expanded dashboard stats.
16. View assessment submission.
17. View agent health with at least one completed and one failed job.
18. Approve or reject freelancer.
19. Freelancer receives notification.

## Sprint 3 Priority Cut Line

Must finish:

- Assessment backend routes.
- Assessment frontend UI.
- Real AI exam generation and grading.
- Admin dashboard stats and review queues.
- Notifications list/read routes.
- Demo seed data.

Should finish:

- Agent jobs overview.
- Queue worker.
- CV extraction after upload.
- Polished mobile assessment UX.

Can cut if time is dying:

- Perfect anti-cheat enforcement.
- Full matching engine.
- Payments.
- Real-time WebSockets.
- Deep admin filtering.
- Full production CI/CD connection.

The demo should favor one clean end-to-end path over many half-connected screens.
