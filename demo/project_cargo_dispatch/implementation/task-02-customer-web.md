# Customer web workstream

## Outcome

Deliver the responsive customer experience from account entry through booking,
tracking, cancellation, and shipment history.

## Owned paths

`apps/web/src/app/(customer)`, `apps/web/src/components/customer`, and
customer-flow tests. Shared primitives may be changed only through a separately
reviewed commit.

## Acceptance evidence

- All customer screens and loading/empty/error states match the UI/UX handoff.
- Keyboard users can enter shipment details, choose a service level and
  collection window, review, and confirm.
- A cut-off that passes mid-booking moves the promised date, explains it inline,
  and requires re-confirmation instead of silently rebooking.
- The tracking timeline renders every milestone and any failure reason, and the
  public code lookup never exposes addresses or contact details.
- Layout works at 320px, tablet, and desktop widths without overlap.
- Component tests cover validation and state; end-to-end tests cover booking,
  tracking, and cancellation against the approved API contract.

## Submission summary

Implemented CargoLink's accessible responsive customer journey with explicit
network, cut-off, and already-collected recovery. Attach screenshots for
mobile/desktop, accessibility results, test output, full commit SHA, and pull
request URL.
