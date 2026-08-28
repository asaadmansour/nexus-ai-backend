# Dispatcher console and manager dashboard workstream

## Outcome

Deliver the dispatcher day board, run stop ordering, driver/vehicle and blackout
editor, and manager delivery performance summary with strict role boundaries.

## Owned paths

`apps/web/src/app/(depot)`, `apps/web/src/components/depot`, and depot-console
tests.

## Acceptance evidence

- Dispatchers can view a date, assign unassigned shipments to a run, reorder
  stops, and advance status with clear optimistic/error behavior.
- Stop reordering is fully keyboard operable with Move up and Move down controls
  and is never drag-only.
- A `RUN_AT_CAPACITY` or `ASSIGNMENT_CONFLICT` response keeps the selected
  shipment, refreshes the run, and announces the change.
- Depot setup exposes drivers, vehicles, service levels, blackout dates,
  validation, and unsaved-change protection.
- Manager summaries include date range, delivered volume, on-time rate, failure
  reasons, and an accessible data table; dispatchers cannot open manager
  reporting.
- Responsive and keyboard checks pass at the same supported viewports.
- Tests cover role denial, status transitions, empty days, capacity conflicts,
  and failed saves.

## Submission summary

Implemented the CargoLink depot operations workspace and manager reporting
against the approved API/design contracts. Attach role test evidence, responsive
screenshots, full commit SHA, and pull request URL.
