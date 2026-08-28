# CargoLink UI/UX implementation handoff

## 1. Design source and screen inventory

The immutable `uiux-prototype.html` is the inspectable responsive design source
and clickable critical-flow prototype. It includes customer shipment booking,
booking review and confirmation, the tracking timeline, the dispatcher day board
with unassigned queue and runs, and the manager performance summary.

The implementation inventory is 12 screens: sign in/account creation; my
shipments; booking addresses and contents; service level and pickup window;
booking review; booking confirmation with tracking code; shipment tracking
timeline; cancellation confirmation; dispatch day board; run detail and stop
ordering; driver, vehicle, and blackout editor; manager performance summary.

## 2. Information architecture

Unauthenticated users enter through sign in or the tracking-code lookup, which
shows milestones only and never addresses. Customer navigation contains Book a
pickup and My shipments. Dispatcher navigation contains Board and Depot setup.
Manager navigation contains Performance and may read the board but cannot move
stops or change status. Role authorization selects the workspace; users never
switch roles in the UI. Page titles identify the current workspace, and mobile
navigation becomes a labelled bottom bar without hiding primary actions.

## 3. Primary user flows

- Booking: enter pickup and delivery details -> choose service level and pickup
  window -> review -> confirm -> tracking code, timeline entry, and email notice.
  A cut-off passed after the form opened moves the promised date forward, explains
  the change inline, and requires re-confirmation instead of silently rebooking.
- Tracking: My shipments -> shipment -> milestone timeline with promised date and
  any failure reason. The public code lookup reaches the same reduced timeline.
- Cancel: shipment -> Cancel pickup -> destructive confirmation -> cancelled state.
  Once collected, the action is replaced by depot contact guidance, not an error.
- Dispatch: Board -> unassigned queue -> assign to a run -> reorder stops ->
  advance status. A full or stale run keeps the selection, refreshes the run, and
  announces that capacity changed.
- Manager: Performance -> date range -> totals and accessible detail table. Empty
  periods show zeros and guidance, not a blank chart.

## 4. Implementation-ready screen designs

The prototype fixes desktop/mobile hierarchy, spacing, colors, controls, status
styles, and the critical customer and dispatcher interactions. At desktop, the
booking flow uses a 280px summary rail beside fluid form content, and the board
uses a two-column unassigned queue plus run workspace. At mobile, all content is
one column, the unassigned queue collapses into a labelled section above the
runs, form steps keep a sticky primary action that respects safe areas, and stop
ordering exposes explicit Move up and Move down buttons rather than drag only.
Tables become labelled row groups below 720px. No content depends on hover, and
no interaction depends on drag alone.

## 5. Clickable prototype

Open `uiux-prototype.html` in a browser. The Customer journey advances from
shipment details through service level, review, confirmation, and the tracking
timeline; role tabs expose the Dispatcher board and the Manager summary. It is a
behavioral prototype, so it uses fixed demo data and no backend. Its annotations
name the matching endpoint and error state; final implementation must use the
approved architecture contract.

## 6. Relevant screen and component states

Every data region has skeleton/loading, empty, inline validation, 403 permission,
network failure with Retry, and success states. Primary actions remain disabled
until required input is valid and explain the missing input next to the field.
A 409 on assignment preserves the selected shipment, refreshes the run's stop
count, and moves focus to the refreshed run. Booking success uses a page state
with a copyable tracking code and a live announcement. Cancellation uses a
focus-trapped dialog, returns focus to the invoking control, and shows the
cancelled status. Status and stop-order updates are optimistic only while a
visible saving indicator is present; failure restores the last server state.

## 7. Responsive and accessibility rules

Use one column at 320-719px, tablet layout at 720-1023px, and constrained desktop
layout from 1024px. Body text is at least 16px; controls are at least 44px. DOM and
focus order match visual order. All inputs have persistent labels and described
errors. Dialogs trap and restore focus. Status always has text plus color, and a
failed delivery always names its reason in text. Meet WCAG 2.1 AA contrast, expose
chart data as a table, announce async results with polite live regions, keep every
reordering action reachable from the keyboard, and disable nonessential motion
under `prefers-reduced-motion`.

## 8. Proportionate design rules

Use Inter or system sans, 16/24 body, 14/20 labels, 20/28 section headings, and
28/36 page titles. Tokens: ink `#151B23`, surface `#FFFFFF`, canvas `#F2F5F8`,
primary `#1B4F8A`, accent `#C2620A`, danger `#B42318`, border `#C9D3DE`.
Spacing is 4, 8, 12, 16, 24, 32, and 48; radius is 6px, except compact status
tags. Reuse labelled Button, TextField, Select, DatePicker, AddressFields,
StopRow, StatusTag, InlineAlert, Dialog, Skeleton, EmptyState, and DataTable
components. Each control defines default, hover, focus, disabled, loading, and
error variants.

## 9. Architecture and API mapping

- ServiceLevelSelect -> `GET /service-levels`; fields name, cutoffTime, promisedDays.
- BookingForm/BookingReview -> `POST /shipments`; customer role; field errors stay
  inline and the response tracking code drives the confirmation screen.
- ShipmentList -> `GET /shipments/me`; ShipmentDetail -> `GET /shipments/:id`.
- TrackingTimeline -> `GET /tracking/:trackingCode` for the public reduced view.
- CancelDialog -> cancel PATCH; a collected shipment shows the 409 guidance state.
- DispatchBoard/RunPanel -> `GET /dispatch/board`; assignment posts stops and
  handles `RUN_AT_CAPACITY` and `ASSIGNMENT_CONFLICT` by refreshing the run.
- StopRow reorder and move -> stop PATCH with version; DELETE unassigns.
- StatusControl -> dispatcher status PATCH; a failure requires a reason code.
- BlackoutEditor -> driver blackout PATCH with version; 409 prompts reload.
- PerformanceSummary -> manager summary GET; a dispatcher 403 is never retried.

All ISO instants render in `Africa/Cairo`. UI status labels use the exact approved
enum mapping and unknown values fall back to a neutral "Needs attention" label.

## 10. Developer handoff

The prototype and this document provide layout, tokens, component inventory,
responsive behavior, copy intent, interaction rules, API mapping, and state
acceptance. Use CSS variables for tokens and shared components for repeated
controls; route-specific components own orchestration. SVG/logo assets must include
accessible names or be decorative. Do not put addresses, contact details, or
tracking codes in analytics or client logs. Open non-blocking questions are the
final depot logo and the failed-delivery email wording; use the text CargoLink
mark and confirmed on-screen copy until supplied.

## 11. Confirmed feature coverage

- Shipment booking: details, service level and window, review, confirmation, and
  cut-off recovery.
- Dispatch assignment: unassigned queue, run selection, stop ordering, and the
  capacity conflict state.
- Delivery status tracking: milestone timeline, failure reason display, and the
  reduced public lookup.
- Delivery performance review: manager date filter, metric summaries, and data table.

No invoicing, payment, live map, telematics, customs, warehouse, or multi-depot
screens are included, and implementers must not infer them from the logistics
domain.
