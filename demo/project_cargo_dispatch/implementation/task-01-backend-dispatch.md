# Backend dispatch workstream

## Outcome

Deliver the directory, capacity, shipment, dispatch, tracking, reporting, and
email outbox contracts from the approved architecture without expanding into
invoicing, telematics, or route optimisation.

## Owned paths

`apps/api/src/auth`, `apps/api/src/directory`, `apps/api/src/capacity`,
`apps/api/src/shipments`, `apps/api/src/dispatch`, `apps/api/src/tracking`,
`apps/api/src/reporting`, and the corresponding migrations/tests.

## Acceptance evidence

- Role guards cover customer, dispatcher, and manager access, and the public
  tracking route returns milestones only, never addresses or contact details.
- Concurrent attempts cannot place one shipment on two runs or push a run past
  its stop capacity; the loser receives `409 RUN_AT_CAPACITY` or
  `409 ASSIGNMENT_CONFLICT`.
- Cancellation and status transitions are idempotent, validated against the
  approved state machine, and audited with actor and timestamp.
- Email outbox jobs retry safely without duplicate customer messages.
- Unit/integration tests cover cut-off and time-zone boundaries, blackout dates,
  capacity races, stop resequencing, permissions, and status transitions.

## Submission summary

Implemented the CargoLink dispatch API and database contract, including
transaction-safe stop assignment, validated delivery status transitions, manager
summaries, and reliable email events. Attach the full commit SHA, test output,
API contract diff, and pull request URL.
