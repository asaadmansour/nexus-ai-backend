# QuickClinic UI/UX handoff

## Experience principles

The interface is calm, direct, and usable by patients with mixed technical
confidence. The primary action is always visible, status relies on text plus
color, focus order follows reading order, and all flows work at 320px width and
with keyboard-only navigation.

## Screen inventory

1. Sign in and account creation.
2. Doctor/service directory with filters.
3. Doctor profile and available-date picker.
4. Slot selection.
5. Booking review and confirmation.
6. Patient upcoming/past appointments.
7. Reschedule flow.
8. Cancellation confirmation.
9. Reception daily calendar.
10. Reception queue board.
11. Doctor availability editor.
12. Manager appointment summary.

## Required states

Each data screen defines loading, empty, validation, permission, offline/network,
and retry states. Slot selection also defines a 409 conflict state: explain that
the slot was just taken, preserve the selected doctor/date, refresh availability,
and move focus to the new slot list. Destructive cancellation uses a confirmation
dialog and announces success through an accessible live region.

## Design system

- Typeface: Inter or system sans; 16px body minimum.
- Colors: ink `#18201D`, surface `#FFFFFF`, canvas `#F4F7F5`, primary `#176B5B`,
  accent `#D8A12E`, danger `#B42318`; all text combinations meet WCAG AA.
- Spacing: 4, 8, 12, 16, 24, 32, 48.
- Radius: 6px for controls/cards, 999px only for compact status tags.
- Controls: 44px minimum target, visible focus ring, persistent labels, inline
  error text, and no color-only meaning.

## Main flows

- Patient: directory -> doctor -> date/slot -> review -> confirmation -> email.
- Reschedule: appointments -> current booking -> new slot -> confirm replacement.
- Reception: calendar -> appointment -> check in -> queue status progression.
- Manager: date range -> summary metrics -> accessible table breakdown.

## Component and API mapping

- `DoctorFilters` and `DoctorList` consume `GET /doctors`.
- `SlotPicker` consumes `GET /doctors/:id/slots` and handles stale-slot 409.
- `BookingReview` posts `POST /appointments`.
- `AppointmentList` reads `GET /appointments/me` and owns reschedule/cancel.
- `DailyCalendar` and `QueueBoard` consume the staff calendar/queue endpoints.
- `AvailabilityEditor` edits weekly rules with unsaved-change protection.
- `AppointmentSummary` reads manager reporting and exposes table data alongside charts.

## Handoff acceptance

The frontend can implement every screen, responsive layout, component state, and
API interaction without inventing product behavior. Open questions are limited to
brand logo assets and final email copy; neither blocks implementation.
