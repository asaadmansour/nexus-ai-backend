# QuickClinic architecture handoff

## Scope boundary

QuickClinic is a modular monolith: one Next.js web client, one NestJS REST API,
PostgreSQL, and a background email worker. It serves one clinic and stores
scheduling data only. Medical records, diagnoses, insurance, payments, SMS,
native apps, and microservices are explicitly out of scope.

## Modules

- Identity: email/password sessions and `patient`, `reception`, `manager` roles.
- Directory: doctors, services, active status, and display information.
- Availability: weekly rules plus dated exceptions, interpreted in
  `Africa/Cairo`.
- Appointments: atomic slot reservation, reschedule, cancellation, and status.
- Queue: current-day checked-in/waiting/in-service/completed ordering.
- Reporting: daily appointment counts, completion, and cancellation rates.
- Notifications: outbox-backed confirmation, reminder, reschedule, and
  cancellation email jobs.

## API contract

- `POST /auth/login`
- `GET /doctors?serviceId=&date=`
- `GET /doctors/:doctorId/slots?date=`
- `POST /appointments` with `doctorId`, `serviceId`, and `startsAt`
- `GET /appointments/me`
- `PATCH /appointments/:id/reschedule`
- `PATCH /appointments/:id/cancel`
- `GET /staff/calendar?date=`
- `PATCH /staff/appointments/:id/status`
- `GET /staff/queue?date=`
- `PATCH /staff/doctors/:id/availability`
- `GET /manager/appointment-summary?from=&to=`

Every mutation returns a stable resource representation. Validation errors use
field-level details; authorization returns 403; missing records return 404; a
slot race returns 409 with `SLOT_UNAVAILABLE` so the client can refresh slots.

## Data model

- `users(id, email, password_hash, role, created_at)`
- `doctors(id, name, specialty, active)`
- `services(id, name, duration_minutes, active)`
- `doctor_services(doctor_id, service_id)`
- `availability_rules(id, doctor_id, weekday, starts_at, ends_at)`
- `availability_exceptions(id, doctor_id, date, starts_at, ends_at, unavailable)`
- `appointments(id, patient_id, doctor_id, service_id, starts_at, ends_at, status, version)`
- `notification_outbox(id, appointment_id, type, status, run_at, attempts)`

A PostgreSQL exclusion/unique scheduling constraint plus a transaction prevents
overlapping active appointments for a doctor. Rescheduling locks the appointment
and target slot. Personally identifiable data is minimized and never written to
application logs.

## Security and operations

- Argon2/bcrypt password hashing, secure cookies or short-lived access tokens,
  rate-limited login, DTO allowlists, and role guards.
- Structured audit events for staff availability and appointment status changes.
- Health/readiness endpoints, migrations on deploy, daily database backup, and
  Sentry-compatible error reporting without patient data.
- Unit tests for scheduling rules, integration tests for slot races and roles,
  and end-to-end tests for booking, rescheduling, cancellation, and queue updates.

## Ownership boundaries

- Backend scheduling: `apps/api/src/{appointments,availability,directory}`.
- Patient web: `apps/web/src/app/(patient)` and patient components.
- Staff web: `apps/web/src/app/(staff)` and staff components.
- Integration/quality: contract tests, end-to-end tests, deployment, and runbooks.
