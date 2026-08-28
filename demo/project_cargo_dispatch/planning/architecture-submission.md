# CargoLink architecture handoff

## 1. System context and scope

CargoLink is a responsive dispatch and tracking web application for one depot.
Business customers book pickups and follow their own shipments, dispatchers build
dated driver runs and advance delivery status, and operations managers read
performance summaries. The browser, API, PostgreSQL database, and email worker
are inside the solution. The transactional email provider is the only external
system.

The public internet/browser boundary is protected by TLS and authenticated API
requests. A single unauthenticated route resolves a tracking code to a reduced
status timeline. Depot routes form a second authorization boundary. The worker
reads only committed outbox records. Live GPS map tracking, automatic route
optimisation, a native driver application, invoicing and payments, customs
paperwork, carrier hand-off APIs, warehouse inventory, and additional depots are
outside the release.

## 2. Architecture diagram

The inspectable Mermaid source is in `architecture-diagram.mmd`. Browsers call a
single Next.js application, which calls the NestJS REST API. The API owns all
authorization, capacity, and assignment transactions in PostgreSQL. Committed
notification outbox rows are processed asynchronously by the email worker;
neither the web application nor API waits for the email provider to accept a
message.

## 3. Technology stack and decisions

- Next.js with TypeScript for one responsive customer/depot web client and
  shared accessible components.
- NestJS REST API with DTO validation and role guards. A modular monolith keeps
  deployment and assignment transactions simple for a single-depot operation.
- PostgreSQL for relational shipment data, transactional locking, indexes, and
  run-capacity protection.
- Redis/BullMQ for retryable notification work only; it is not a dispatch source
  of truth and never holds shipment state.
- A transactional email provider behind a small adapter so local development can
  use a fake transport.
- Docker containers, GitHub Actions, and one managed staging/production service.
  Microservices, GraphQL, event streaming, map/telematics services, and
  Kubernetes add no value at one depot with a manual dispatcher.

## 4. Modules and ownership boundaries

- Identity owns users, password hashes, sessions, and customer/dispatcher/manager
  authorization.
- Directory owns drivers, vehicles, service levels, delivery zones, and activation.
- Capacity owns dated runs, their stop capacity, and driver/vehicle blackout dates.
- Shipments owns booking, tracking codes, addresses, cancellation, and ownership.
- Dispatch owns stop assignment, stop ordering, reassignment, and capacity locks.
- Tracking owns status transitions, failure reasons, and the shipment event timeline.
- Reporting owns read-only delivered volume, on-time rate, and failure rate.
- Notifications owns outbox records, retry policy, templates, and provider calls.

Modules expose application services and REST DTOs, not each other's repositories.
Dispatch may query Directory and Capacity through their public services; Tracking
writes only through Dispatch-approved transitions; Notifications consumes
committed outbox rows. This permits four implementation workstreams without
splitting the system into network services.

## 5. API and event contracts

- `POST /auth/login`: anonymous; email/password; returns the authenticated user
  and session/access token. Invalid credentials return 401 with `INVALID_CREDENTIALS`.
- `GET /service-levels`: customer; returns active service levels, cut-off times,
  and promised transit days.
- `GET /tracking/:trackingCode`: anonymous; returns status, promised date, and
  milestone timeline only, never addresses or contact details.
- `POST /shipments`: customer; `{serviceLevelId, pickup, delivery, pieces,
  weightKg, reference}`; returns 201 with the generated tracking code.
- `GET /shipments/me`: customer; returns open and closed shipments.
- `GET /shipments/:id`: owning customer or depot staff; full detail and timeline.
- `PATCH /shipments/:id/cancel`: owning customer before pickup; optional reason;
  idempotent; returns 409 `SHIPMENT_ALREADY_COLLECTED` once a stop is completed.
- `GET /dispatch/board?date=`: dispatcher/manager; unassigned queue plus runs.
- `POST /dispatch/runs`: dispatcher; `{runDate, driverId, vehicleId, zoneId,
  capacityStops}`; returns 201.
- `POST /dispatch/runs/:runId/stops`: dispatcher; `{shipmentId, kind, sequence}`;
  returns 201 or 409 `RUN_AT_CAPACITY` / `ASSIGNMENT_CONFLICT`.
- `PATCH /dispatch/stops/:id`: dispatcher; resequence or move to another run with
  an optimistic version; `DELETE /dispatch/stops/:id` unassigns before departure.
- `PATCH /dispatch/shipments/:id/status`: dispatcher; collected, in_transit,
  out_for_delivery, delivered, or failed with a required reason code.
- `PATCH /dispatch/drivers/:id/blackouts`: dispatcher/manager; dated blackouts
  with optimistic version.
- `GET /manager/delivery-summary?from=&to=`: manager only; volume, on-time rate,
  and failure reasons.

DTO failures return 400 with field details, authorization returns 403, missing
resources return 404, and a full or stale run returns 409. Mutations accept an
idempotency key. The internal `shipment.notification-requested` outbox event
contains shipment ID, template type, recipient email, and occurrence ID;
consumers deduplicate by occurrence ID.

## 6. Data model

- `users(id, email unique, password_hash, role, company_name, created_at)`.
- `drivers(id, name, licence_class, active)` and
  `vehicles(id, plate unique, capacity_stops, capacity_kg, active)`.
- `service_levels(id, name, cutoff_time, promised_days, active)` and
  `zones(id, name, active)` with `zone_postcodes(zone_id, postcode)` unique pair.
- `runs(id, run_date, driver_id, vehicle_id, zone_id, capacity_stops, status,
  version)` with unique `(driver_id, run_date)` and unique `(vehicle_id, run_date)`.
- `driver_blackouts(id, driver_id, date, reason)` unique `(driver_id, date)`.
- `shipments(id, customer_id, tracking_code unique, service_level_id, zone_id,
  pickup_address, delivery_address, delivery_postcode, pieces, weight_kg, status,
  promised_date, version, created_at, updated_at)`.
- `stops(id, run_id, shipment_id, kind, sequence, status, arrived_at,
  completed_at, version)` with unique `(run_id, sequence)` and a partial unique
  index on `(shipment_id, kind)` for active stops.
- `tracking_events(id, shipment_id, status, occurred_at, actor_id, reason_code,
  note)`.
- `notification_outbox(id, shipment_id, type, occurrence_id unique, status,
  run_at, attempts, last_error)`.

Indexes cover run/date board lookup, unassigned shipments by zone and promised
date, customer shipment lists, tracking-code lookup, timeline reads, and due
outbox jobs. Assigning a stop locks the run row, counts active stops against
`capacity_stops`, and rejects the loser with 409 rather than overfilling a
vehicle. Resequencing rewrites the affected sequences inside one transaction.
Migrations are additive first; destructive cleanup follows only after compatible
application deployment.

## 7. External integrations

Transactional email sends booking confirmations, collection notices, delivery
confirmations, and failed-delivery notices. The worker claims committed outbox
rows, uses occurrence ID as the provider idempotency key, times out after 10
seconds, and retries network/429/5xx failures at 1, 5, and 20 minutes. A
permanent 4xx address failure is recorded and shown to depot staff without
reversing the shipment or its status. Provider downtime never blocks booking or
dispatch. No payment, invoicing, SMS, map/telematics, customs, or carrier
integration is permitted in this release.

## 8. Proportionate non-functional requirements

- Dispatch board and tracking reads: p95 under 500 ms at 50 concurrent users;
  mutations p95 under 800 ms excluding background email.
- Zero shipments assigned to two runs and zero runs over capacity under a
  20-request concurrency test.
- 99.5% monthly application availability; health endpoint checked every minute.
- WCAG 2.1 AA, keyboard-complete flows, 44px targets, and 320px minimum viewport.
- Password hashes and TLS in transit; no driver location history, no payment
  data, and no customer addresses in logs or on the public tracking route. Audit
  every status transition and dispatch reassignment with actor and timestamp.
- Cairo time is stored as UTC instants and displayed using `Africa/Cairo`; the
  service-level cut-off is evaluated in depot local time.
- Support current and previous major Chrome, Edge, Firefox, and Safari versions.

## 9. Deployment and operations

Use local, staging, and production environments with validated environment
variables for database, Redis, session secrets, public URL, and email adapter.
CI runs formatting, lint, type checks, unit/integration tests, migration checks,
and booking/assignment/status end-to-end tests. Deploy migrations before the API,
then worker and web; smoke-test health, login, booking, one assignment, and one
fake-provider notification. Structured logs contain request/correlation IDs but
no addresses or contact details. Alert on health failure, elevated 5xx, queue
backlog, unassigned shipments past cut-off, or repeated email failure. Back up
PostgreSQL daily with 14-day retention and quarterly restore testing. Rollback
uses the previous container image; migrations remain backward compatible.

## 10. Implementation and integration handoff

Repository layout is `apps/api`, `apps/web`, `packages/contracts`, `tests`,
`deploy`, and `docs/runbooks`. Shared request/response schemas in
`packages/contracts` are architect-owned; a contract change requires its own
review. Work order is contracts/schema, backend dispatch, customer and depot web
in parallel against contract fixtures, then integration/release. TypeScript strict
mode, migration-per-schema-change, conventional test names, and no cross-module
repository imports are required. Integration checkpoints are contract tests,
capacity-race tests, role matrix tests, responsive UI checks, end-to-end journeys,
then staging smoke/rollback.

Ownership: backend dispatch owns `apps/api/src/{shipments,dispatch,capacity,
directory,tracking,reporting}`; customer web owns `apps/web/src/app/(customer)`;
depot web owns `apps/web/src/app/(depot)`; integration/quality owns contract and
end-to-end tests, CI, deployment, and runbooks.

## 11. Confirmed feature coverage

- Shipment booking: Directory validates the service level and zone, Shipments
  writes the booking and tracking code atomically, and Notifications sends the
  confirmation.
- Dispatch assignment: Dispatch locks the target run, enforces stop capacity and
  single active assignment, and records the ordered stop.
- Delivery status tracking: Tracking validates dispatcher-only transitions, writes
  the timeline event, and exposes a reduced public view by tracking code.
- Delivery performance review: Reporting returns manager-only date-range volume,
  on-time rate, and failure reasons without exposing addresses.

These four features are the approved product boundary. Supporting identity,
directory, capacity, and email behavior exists only to make them operable.
