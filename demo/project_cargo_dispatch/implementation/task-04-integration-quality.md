# Integration, quality, and release workstream

## Outcome

Integrate the independently owned workstreams, verify contract compatibility,
and produce a reproducible staging release without taking ownership of feature
implementation paths.

## Owned paths

`tests/e2e`, `tests/contracts`, `.github/workflows`, `deploy`, and `docs/runbooks`.
Feature-code fixes return to the owning freelancer through focused review notes.

## Acceptance evidence

- Contract tests prove the web clients use only approved endpoint shapes.
- End-to-end tests cover customer booking/tracking/cancellation, dispatcher
  assignment and status handling, manager access, and forbidden-role cases.
- A concurrency test proves no shipment reaches two runs and no run exceeds its
  stop capacity.
- CI runs lint, type checks, unit/integration/e2e tests, and migration checks.
- Staging deploy documents configuration, migrations, rollback, health checks,
  backup/restore, and seeded smoke-test accounts.
- Security smoke tests confirm the public tracking route leaks no addresses or
  contact details and that no address or contact data appears in logs.

## Submission summary

Integrated and verified the four CargoLink workstreams, added contract/end-to-end
coverage, and documented the staging release and rollback. Attach the CI URL,
staging URL, full commit SHA, test report, and release pull request.
