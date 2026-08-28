# Backend scheduling workstream

## Outcome

Deliver the directory, availability, appointment, queue, reporting, and email
outbox contracts from the approved architecture without expanding into medical
records or payments.

## Owned paths

`apps/api/src/auth`, `apps/api/src/directory`, `apps/api/src/availability`,
`apps/api/src/appointments`, `apps/api/src/queue`, `apps/api/src/reporting`, and
the corresponding migrations/tests.

## Acceptance evidence

- Role guards cover patient, reception, and manager access.
- Concurrent attempts cannot reserve the same doctor slot; the loser receives
  `409 SLOT_UNAVAILABLE`.
- Reschedule and cancel operations are idempotent and audited.
- Email outbox jobs retry safely without duplicate customer messages.
- Unit/integration tests cover time-zone boundaries, dated exceptions, slot
  races, permissions, and appointment status transitions.

## Submission summary

Implemented the QuickClinic scheduling API and database contract, including
transaction-safe slot reservation, staff queue updates, manager summaries, and
reliable email events. Attach the full commit SHA, test output, API contract diff,
and pull request URL.
