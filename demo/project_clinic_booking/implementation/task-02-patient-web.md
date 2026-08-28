# Patient web workstream

## Outcome

Deliver the responsive patient experience from account entry through booking,
rescheduling, cancellation, and appointment history.

## Owned paths

`apps/web/src/app/(patient)`, `apps/web/src/components/patient`, and patient-flow
tests. Shared primitives may be changed only through a separately reviewed commit.

## Acceptance evidence

- All patient screens and loading/empty/error states match the UI/UX handoff.
- Keyboard users can filter doctors, choose a date/slot, review, and confirm.
- The stale-slot 409 state preserves context, refreshes slots, and moves focus.
- Layout works at 320px, tablet, and desktop widths without overlap.
- Component tests cover validation and state; end-to-end tests cover booking,
  rescheduling, and cancellation against the approved API contract.

## Submission summary

Implemented QuickClinic's accessible responsive patient journey with explicit
network and slot-conflict recovery. Attach screenshots for mobile/desktop,
accessibility results, test output, full commit SHA, and pull request URL.
