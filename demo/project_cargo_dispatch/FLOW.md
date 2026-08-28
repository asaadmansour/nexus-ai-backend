# CargoLink end-to-end demo flow

Use this order so every actor sees the workflow state intended for their role.
The scripts stop at real workflow gates and never mark funding, reviews, or
invitations complete on an actor's behalf.

## 1. Prepare the local demo

1. Start PostgreSQL, Redis, the backend, the backend worker, and the AI service.
2. On disposable local data only, run `npm run seed:real -- --yes`.
3. Create `demo/project_cargo_dispatch/.env` from `.env.example`.
4. Run `npm run demo:cargo:validate`.

Checkpoint: every command is healthy and the seeded users can sign in.

## 2. Client intake

1. Run `npm run demo:cargo:intake`.
2. Sign in as the customer and review the completed CargoLink brief.
3. Confirm the brief in the client UI. To automate only this confirmation in a
   disposable run, set `DEMO_CONFIRM_BRIEF=true` and rerun the intake command.
4. Keep the printed `DEMO_PROJECT_ID` for later commands if project discovery is
   ambiguous.

Checkpoint: the brief is complete and confirmed, and the project has entered the
real quoting/reviewer workflow.

## 3. Principal review and planning team

1. Sign in as the principal reviewer and complete the project review.
2. Let matching recommend the architecture and UI/UX planning team.
3. Sign in as the client and complete the planning funding action.
4. Sign in as each invited planning freelancer, accept the invitation, and start
   the assignment.

Checkpoint: one active `architect` assignment and one active `ui_ux` assignment
exist for the project.

## 4. Architecture and UI/UX submissions

1. Run `npm run demo:cargo:planning` to generate payloads without submitting.
2. Review `output/architecture-submission.json` and
   `output/ui_ux-submission.json` against the live adaptive requirements.
3. Run `npm run demo:cargo:planning -- --submit` to submit both handoffs.
4. Review and approve both deliverables using the principal reviewer flow.

Checkpoint: both planning submissions are approved and plan generation can use
their contracts. The generated Scrum plan must not exceed four implementation
freelancers.

## 5. Scrum plan and implementation staffing

1. Review the generated milestones, dependencies, owned paths, acceptance
   criteria, and role counts.
2. Approve the plan. If changes are requested, include a concrete note and wait
   for the regenerated plan before reviewing again.
3. Complete implementation funding as the client.
4. Let matching assign the implementation tasks, then accept each invitation as
   the selected freelancer.

Checkpoint: every materialized task is funded, assigned, and ready for work. A
single freelancer may own compatible tasks in this project, up to the platform's
three-task-per-project limit.

## 6. Freelancer submissions

1. Run `npm run demo:cargo:implementation` to generate a payload for every task
   owned by the configured freelancer accounts.
2. Replace the demo evidence note with the real branch, full commit SHA, CI run,
   pull request, screenshots, and staging links required by that task.
3. Submit through the UI for the main demo, or run
   `npm run demo:cargo:implementation -- --submit` for the text-evidence API
   path.
4. Complete principal review, revision, and approval using the normal UI.

Checkpoint: each task has independently verifiable evidence tied to its owned
paths and approved planning contracts.
