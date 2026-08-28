# QuickClinic UI/UX implementation handoff

## 1. Design source and screen inventory

The immutable `uiux-prototype.html` is the inspectable responsive design source
and clickable critical-flow prototype. It includes patient directory, slot
selection, booking review/confirmation, appointments/rescheduling, reception
calendar/queue, doctor availability, and manager summary views.

The implementation inventory is 12 screens: sign in/account creation; doctor and
service directory; doctor/date details; slot selection; booking review;
confirmation; patient appointments; reschedule; cancellation confirmation;
reception calendar/queue; availability editor; manager activity summary.

## 2. Information architecture

Unauthenticated users enter through sign in or the doctor directory. Patient
navigation contains Find appointment and My appointments. Reception navigation
contains Today and Availability. Manager navigation contains Activity and may
read Today but cannot edit queue state. Role authorization selects the workspace;
users never switch roles in the UI. Page titles identify the current workspace,
and mobile navigation becomes a labelled bottom bar without hiding primary actions.

## 3. Primary user flows

- Booking: filter service -> select doctor/date -> select live slot -> review ->
  confirm -> success and email notice. A 409 keeps doctor/date, refreshes slots,
  announces that the time was taken, and focuses the new slot list.
- Reschedule: My appointments -> Reschedule -> choose new date/slot -> compare old
  and new -> confirm. Cancellation remains available and is not implicit.
- Cancel: appointment -> Cancel -> destructive confirmation -> cancelled state.
- Reception: Today -> appointment -> Check in -> Waiting -> In service -> Complete.
  Invalid transitions restore server state and show an inline retry action.
- Manager: Activity -> date range -> totals and accessible detail table. Empty
  periods show zeros and guidance, not a blank chart.

## 4. Implementation-ready screen designs

The prototype fixes desktop/mobile hierarchy, spacing, colors, controls, status
styles, and the critical patient interaction. At desktop, patient selection uses
a 280px filter rail and fluid results; staff views use a compact top bar plus
calendar/queue workspace. At mobile, all content is one column, filters open in a
labelled sheet, slot buttons form two columns, and sticky actions respect safe
areas. Tables become labelled row groups below 720px. No content depends on hover.

## 5. Clickable prototype

Open `uiux-prototype.html` in a browser. The Patient journey advances from doctor
selection through slot, review, and confirmation; role tabs expose Reception and
Manager layouts. It is a behavioral prototype, so it uses fixed demo data and no
backend. Its annotations name the matching endpoint and error state; final
implementation must use the approved architecture contract.

## 6. Relevant screen and component states

Every data region has skeleton/loading, empty, inline validation, 403 permission,
network failure with Retry, and success states. Primary actions remain disabled
until required input is valid and explain the missing input next to the field.
Slot 409 preserves context and moves focus to refreshed results. Booking success
uses a page state and live announcement. Cancellation uses a focus-trapped dialog,
returns focus to the invoking control, and shows the cancelled status. Queue
updates are optimistic only while a visible saving indicator is present; failure
restores the last server state.

## 7. Responsive and accessibility rules

Use one column at 320-719px, tablet layout at 720-1023px, and constrained desktop
layout from 1024px. Body text is at least 16px; controls are at least 44px. DOM and
focus order match visual order. All inputs have persistent labels and described
errors. Dialogs trap and restore focus. Status always has text plus color. Meet
WCAG 2.1 AA contrast, expose chart data as a table, announce async results with
polite live regions, and disable nonessential motion under `prefers-reduced-motion`.

## 8. Proportionate design rules

Use Inter or system sans, 16/24 body, 14/20 labels, 20/28 section headings, and
28/36 page titles. Tokens: ink `#18201D`, surface `#FFFFFF`, canvas `#F4F7F5`,
primary `#176B5B`, accent `#D8A12E`, danger `#B42318`, border `#CBD5D0`.
Spacing is 4, 8, 12, 16, 24, 32, and 48; radius is 6px, except compact status
tags. Reuse labelled Button, TextField, Select, DatePicker, SlotButton, StatusTag,
InlineAlert, Dialog, Skeleton, EmptyState, and DataTable components. Each control
defines default, hover, focus, disabled, loading, and error variants.

## 9. Architecture and API mapping

- DoctorFilters/DoctorList -> `GET /doctors`; fields name, specialty, services.
- SlotPicker -> `GET /doctors/:id/slots`; fields startsAt/available; 409 refreshes.
- BookingReview -> `POST /appointments`; patient role; field errors stay inline.
- AppointmentList -> `GET /appointments/me`; reschedule/cancel use their PATCH
  endpoints and require ownership.
- DailyCalendar/QueueBoard -> staff calendar/queue GET plus reception-only status
  PATCH; 403 shows the permission screen.
- AvailabilityEditor -> availability PATCH with version; 409 prompts reload.
- AppointmentSummary -> manager summary GET; reception 403 is never retried.

All ISO instants render in `Africa/Cairo`. UI status labels use the exact approved
enum mapping and unknown values fall back to a neutral "Needs attention" label.

## 10. Developer handoff

The prototype and this document provide layout, tokens, component inventory,
responsive behavior, copy intent, interaction rules, API mapping, and state
acceptance. Use CSS variables for tokens and shared components for repeated
controls; route-specific components own orchestration. SVG/logo assets must include
accessible names or be decorative. Do not put patient details in analytics or
client logs. Open non-blocking questions are the final clinic logo and email copy;
use the text QuickClinic mark and confirmed on-screen copy until supplied.

## 11. Confirmed feature coverage

- Appointment booking: directory, doctor/date, slots, review, success, and 409.
- Appointment rescheduling: appointment detail, new slot, comparison, confirmation.
- Daily queue management: reception day list, queue order, and status controls.
- Appointment activity review: manager date filter, metric summaries, and data table.

No medical-record, insurance, payment, native-app, or multi-location screens are
included, and implementers must not infer them from the healthcare domain.
