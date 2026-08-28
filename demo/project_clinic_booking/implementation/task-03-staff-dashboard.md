# Reception and manager dashboard workstream

## Outcome

Deliver the reception calendar, live queue, doctor availability editor, and
manager appointment summary with strict role boundaries.

## Owned paths

`apps/web/src/app/(staff)`, `apps/web/src/components/staff`, and staff-dashboard
tests.

## Acceptance evidence

- Reception can view a day, check patients in, and move appointments through the
  approved queue states with clear optimistic/error behavior.
- Availability editing exposes weekly rules, dated exceptions, validation, and
  unsaved-change protection.
- Manager summaries include date range, counts, cancellation rate, and an
  accessible data table; reception cannot open manager reporting.
- Responsive and keyboard checks pass at the same supported viewports.
- Tests cover role denial, queue state transitions, empty days, and failed saves.

## Submission summary

Implemented the QuickClinic staff operations workspace and manager reporting
against the approved API/design contracts. Attach role test evidence, responsive
screenshots, full commit SHA, and pull request URL.
