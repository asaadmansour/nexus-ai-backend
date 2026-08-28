# QuickClinic architecture handoff

## 1. System context and scope

QuickClinic is a responsive scheduling web application for one clinic. Patients
book and manage their own appointments, reception staff maintain availability
and the daily queue, and managers read appointment activity summaries. The
browser, API, PostgreSQL database, and email worker are inside the solution.
The transactional email provider is the only external system.

The public internet/browser boundary is protected by TLS and authenticated API
requests. Staff routes form a second authorization boundary. The worker reads
only committed outbox records. Medical records, diagnoses, insurance, payments,
SMS, EHR connections, native applications, and multiple clinic locations are
outside the release.

## 2. Architecture diagram

The inspectable Mermaid source is in `architecture-diagram.mmd`. Browsers call a
single Next.js application, which calls the NestJS REST API. The API owns all
authorization and scheduling transactions in PostgreSQL. Committed notification
outbox rows are processed asynchronously by the email worker; neither the web
application nor API waits for the email provider to accept a message.

## 3. Technology stack and decisions

- Next.js with TypeScript for one responsive patient/staff web client and shared
  accessible components.
- NestJS REST API with DTO validation and role guards. A modular monolith keeps
  deployment and transactions simple for a single-location clinic.
- PostgreSQL for relational scheduling data, transactional locking, indexes, and
  overlap protection.
- Redis/BullMQ for retryable reminder and notification work only; it is not a
  scheduling source of truth.
- A transactional email provider behind a small adapter so local development can
  use a fake transport.
- Docker containers, GitHub Actions, and one managed staging/production service.
  Microservices, GraphQL, event streaming, and Kubernetes add no value here.

## 4. Modules and ownership boundaries

- Identity owns users, password hashes, sessions, and patient/reception/manager
  authorization.
- Directory owns doctors, services, activation, and doctor-service membership.
- Availability owns weekly rules, dated exceptions, and Cairo-time slot queries.
- Appointments owns booking, rescheduling, cancellation, status, and slot locks.
- Queue owns the current-day checked-in/waiting/in-service/completed order.
- Reporting owns read-only daily counts and cancellation rates.
- Notifications owns outbox records, retry policy, templates, and provider calls.

Modules expose application services and REST DTOs, not each other's repositories.
Appointments may query Directory and Availability through their public services;
Notifications consumes committed outbox rows. This permits four implementation
workstreams without splitting the system into network services.

## 5. API and event contracts

- `POST /auth/login`: anonymous; email/password; returns the authenticated user
  and session/access token. Invalid credentials return 401 with `INVALID_CREDENTIALS`.
- `GET /doctors?serviceId=&date=`: public; returns active doctors and services.
- `GET /doctors/:doctorId/slots?date=`: public; returns Cairo-time ISO slots.
- `POST /appointments`: patient; `{doctorId, serviceId, startsAt}`; returns 201.
- `GET /appointments/me`: patient; returns upcoming and past appointments.
- `PATCH /appointments/:id/reschedule`: owning patient; `{startsAt}`; returns the
  updated appointment.
- `PATCH /appointments/:id/cancel`: owning patient; optional reason; idempotent.
- `GET /staff/calendar?date=` and `GET /staff/queue?date=`: reception/manager.
- `PATCH /staff/appointments/:id/status`: reception; checked-in, waiting,
  in-service, completed, or no-show.
- `PATCH /staff/doctors/:id/availability`: reception/manager; weekly rules and
  dated exceptions with optimistic version.
- `GET /manager/appointment-summary?from=&to=`: manager only; totals and rates.

DTO failures return 400 with field details, authorization returns 403, missing
resources return 404, and a stale/occupied slot returns 409
`SLOT_UNAVAILABLE`. Mutations accept an idempotency key. The internal
`appointment.notification-requested` outbox event contains appointment ID,
template type, recipient email, and occurrence ID; consumers deduplicate by
occurrence ID.

## 6. Data model

- `users(id, email unique, password_hash, role, created_at)`.
- `doctors(id, name, specialty, active)` and
  `services(id, name, duration_minutes, active)`.
- `doctor_services(doctor_id, service_id)` unique pair.
- `availability_rules(id, doctor_id, weekday, starts_at, ends_at, version)`.
- `availability_exceptions(id, doctor_id, date, starts_at, ends_at, unavailable)`.
- `appointments(id, patient_id, doctor_id, service_id, starts_at, ends_at,
  status, version, created_at, updated_at)`.
- `notification_outbox(id, appointment_id, type, occurrence_id unique, status,
  run_at, attempts, last_error)`.

Indexes cover doctor/date slot lookup, patient/upcoming appointments, daily queue
status, and due outbox jobs. A PostgreSQL exclusion constraint on doctor and time
range for active statuses prevents overlap. Rescheduling locks the appointment
and target range in one transaction. Migrations are additive first; destructive
cleanup follows only after compatible application deployment.

## 7. External integrations

Transactional email sends confirmations, reschedules, cancellations, and
reminders. The worker claims committed outbox rows, uses occurrence ID as the
provider idempotency key, times out after 10 seconds, and retries network/429/5xx
failures at 1, 5, and 20 minutes. A permanent 4xx address failure is recorded and
shown to staff without reversing the appointment. Provider downtime never blocks
booking. No payment, SMS, maps, insurance, social login, or EHR integration is
permitted in this release.

## 8. Proportionate non-functional requirements

- Slot and calendar reads: p95 under 500 ms at 50 concurrent users; mutations p95
  under 800 ms excluding background email.
- Zero double-booked active doctor slots under a 20-request concurrency test.
- 99.5% monthly application availability; health endpoint checked every minute.
- WCAG 2.1 AA, keyboard-complete flows, 44px targets, and 320px minimum viewport.
- Password hashes and TLS in transit; no medical notes/diagnoses and no PII in
  logs. Audit staff availability and appointment-state changes.
- Cairo time is stored as UTC instants and displayed using `Africa/Cairo`.
- Support current and previous major Chrome, Edge, Firefox, and Safari versions.

## 9. Deployment and operations

Use local, staging, and production environments with validated environment
variables for database, Redis, session secrets, public URL, and email adapter.
CI runs formatting, lint, type checks, unit/integration tests, migration checks,
and booking/rescheduling/queue end-to-end tests. Deploy migrations before the
API, then worker and web; smoke-test health, login, slots, and one fake-provider
booking. Structured logs contain request/correlation IDs but no patient details.
Alert on health failure, elevated 5xx, queue backlog, or repeated email failure.
Back up PostgreSQL daily with 14-day retention and quarterly restore testing.
Rollback uses the previous container image; migrations remain backward compatible.

## 10. Implementation and integration handoff

Repository layout is `apps/api`, `apps/web`, `packages/contracts`, `tests`,
`deploy`, and `docs/runbooks`. Shared request/response schemas in
`packages/contracts` are architect-owned; a contract change requires its own
review. Work order is contracts/schema, backend scheduling, patient and staff web
in parallel against contract fixtures, then integration/release. TypeScript strict
mode, migration-per-schema-change, conventional test names, and no cross-module
repository imports are required. Integration checkpoints are contract tests,
slot-race tests, role matrix tests, responsive UI checks, end-to-end journeys,
then staging smoke/rollback.

Ownership: backend scheduling owns `apps/api/src/{appointments,availability,
directory,queue,reporting}`; patient web owns `apps/web/src/app/(patient)`;
staff web owns `apps/web/src/app/(staff)`; integration/quality owns contract and
end-to-end tests, CI, deployment, and runbooks.

## 11. Confirmed feature coverage

- Appointment booking: Directory and Availability produce eligible slots;
  Appointments reserves one atomically and Notification sends confirmation.
- Appointment rescheduling: Appointments authorizes ownership, locks current and
  target slots, replaces the time atomically, and emits one email occurrence.
- Daily queue management: Queue projects today's eligible appointments and
  validates reception-only status transitions.
- Appointment activity review: Reporting returns manager-only date-range counts,
  completion totals, no-shows, and cancellation rate without medical data.

These four features are the approved product boundary. Supporting identity,
directory, availability, and email behavior exists only to make them operable.
