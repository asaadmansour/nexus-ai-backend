x# QuickClinic demo project

This kit exercises the customer intake, planning, Scrum-plan, matching, and
submission flow with a small-to-medium project designed for at most four
implementation freelancers.

## Project shape

- Responsive web application, not a native mobile app.
- Three user groups: patients, reception staff, and clinic managers.
- Four implementation workstreams: backend scheduling, patient experience,
  staff dashboard, and integration/quality.
- `suggestedTeamSize` is four. The planning agent treats this as a hard maximum;
  it may create more granular tasks and assign compatible tasks to the same role.

## Prerequisites

1. Run the backend and AI service, including their workers.
2. Have a verified customer plus assigned architect/UI/UX and implementation
   freelancer accounts. `npm run seed:real -- --yes` provides suitable local
   accounts, but it is destructive and should only be used on disposable data.
3. Copy `.env.example` to `.env` in this folder and adjust the credentials.

## Commands

Run these from `nexus-ai-backend`:

```bash
npm run demo:clinic:validate
npm run demo:clinic:answers
npm run demo:clinic:intake
npm run demo:clinic:planning
npm run demo:clinic:implementation
```

`demo:clinic:intake` creates the client project, sends a complete labelled brief
through the real requirements chat, verifies that the brief is complete, and
optionally confirms it.

`demo:clinic:answers` needs no server or login. It writes copy-ready architecture
and UI/UX answers, including evidence URLs, under `output/` for the live form.

`demo:clinic:planning` discovers the architect and UI/UX assignments, reads the
live adaptive requirements, and writes ready-to-submit payloads under `output/`.
Pass `--submit` after both planning assignments are active to post them.

`demo:clinic:implementation` logs in each configured implementation freelancer,
discovers their assigned QuickClinic tasks, and writes one submission payload per
task under `output/`. Pass `--submit` to create text submissions through the API.
For repository evaluation, replace the text payload's URLs and commit details
with the freelancer's real branch and pull request before final submission.

## Workflow gates

The scripts do not fake funding, invitations, approvals, or task ownership. If a
gate is not ready, they stop and name the required UI/API action. This keeps the
demo useful for regression testing instead of silently forcing impossible state.

The ready-made human handoffs are:

- `planning/architecture-submission.md`
- `planning/architecture-answers.json` (ready answers for every live checklist field)
- `planning/architecture-diagram.mmd`
- `planning/uiux-submission.md`
- `planning/uiux-answers.json` (ready answers for every live checklist field)
- `planning/uiux-prototype.html`
- `implementation/task-01-backend-scheduling.md`
- `implementation/task-02-patient-web.md`
- `implementation/task-03-staff-dashboard.md`
- `implementation/task-04-integration-quality.md`

Generated payloads in `output/` are intentionally ignored by Git.

See `FLOW.md` for the actor-by-actor UI and script runbook.
