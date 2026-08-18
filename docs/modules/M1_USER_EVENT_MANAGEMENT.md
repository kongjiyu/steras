# M1 — User and Event Management

**Owner:** Module 1 teammate

**PRD requirements:** FR-01 to FR-06

## Goal

Own the organiser identity and event-application lifecycle from registration through immutable submission, revision, withdrawal, status tracking, and public approved-event display.

M1 does not calculate risk, recommend resources, make authority decisions, or manage incident handling.

## Current Progress

- All owned routes and page files are implemented.
- Organiser registration/login, drafts, verified/custom venue input, uploads, immutable submission, withdrawal, live status, event list/detail, and public approved-event views exist.
- Submission and withdrawal Callable Functions plus base Firestore/Storage access protection exist.
- Remaining gaps are complete lifecycle UAT, revision-path verification, notification presentation, M4 navigation, and broader browser coverage.

## Current Delivery Goal

Complete and verify the organiser application lifecycle: register, draft, upload, submit, view status, respond to revision, withdraw when eligible, and view sanitised approved events. The detailed work package and acceptance evidence are in `docs/TEAM_GOALS.md`.

## Owned Pages

| Route | Page | Responsibility |
|---|---|---|
| `/login` | `pages/auth/LoginPage.tsx` | Sign-in, reset request, role-aware redirect |
| `/register` | `pages/auth/RegisterPage.tsx` | Public organiser registration only |
| `/organizer` | `pages/organizer/OrganizerDashboard.tsx` | Organiser starting point and workflow summary |
| `/organizer/events/new` | `pages/organizer/NewEvent.tsx` | Create draft and upload current-version evidence |
| `/organizer/events/:eventId/edit` | `pages/organizer/NewEvent.tsx` | Edit a draft or requested revision |
| `/organizer/events` | `pages/organizer/MyEvents.tsx` | Owned application list and status tracking |
| `/organizer/events/:eventId` | `pages/organizer/EventDetail.tsx` | Owned application detail; consumes M2 assessment/resources and M3 decisions |
| `/calendar` | `pages/public/PublicCalendar.tsx` | Sanitised approved-event calendar |
| `/events/:eventId` | `pages/public/PublicEventDetail.tsx` | Sanitised approved-event detail |

M1 owns each full page file above. M2 and M3 provide typed data contracts; they do not directly alter these pages without an M1 handoff.

## Owned Backend and Data

- `frontend/src/contexts/AuthContext.tsx` and organiser profile creation
- `functions/src/http/submitEvent.ts`
- `functions/src/http/withdrawEvent.ts`
- draft and upload behavior in organiser pages
- `users/{uid}` organiser profiles
- `events/{eventId}` application records
- `events/{eventId}/versions/{versionId}` immutable submissions
- version-scoped files under `event_documents/{eventId}/{versionId}/`
- sanitised `public_events` presentation; M3 owns the publication decision

## Locked Assumptions

- Public registration always creates `role: organizer`; it can never grant authority access.
- Event versions are `v1`, `v2`, and so on and are immutable after submission.
- A submission must include event type, venue name/address/location/capacity, attendance, start/end time, environment, coverage, seating, organiser details, and an emergency-plan summary.
- `venueId` is optional, but the form should prefer the verified venue registry. When present, M2 uses the stable ID for verified capacity and comparable-history retrieval; custom venues are marked unmatched and require manual review.
- M1 collects the M2 all-hazards profile (food/water, vulnerable attendees, temporary structures, pyrotechnics, medical/crowd/traffic/weather plans and related declarations). Declared controls do not reduce risk until another authorised workflow verifies them.
- Expected attendance cannot exceed submitted venue capacity.
- Evidence is version scoped and limited to approved PDF/image types and size limits defined by Storage Rules.
- Organiser-visible lifecycle is Draft, Pending, Under Review, Revision Requested, Approved, Rejected, or Withdrawn.
- Only Draft and Revision Requested applications are editable. Draft or Pending applications may be withdrawn under current prototype rules.
- Public pages read only `public_events`; they never read private application documents directly.

## Inputs From Other Modules

| Provider | M1 consumes |
|---|---|
| M2 | Assessment processing/ready/failed state, official score/profile, advisory explanation status, and resource recommendation |
| M3 | Current decision status, revision/rejection rationale, approval/publication state, and notifications |
| M4 | Organiser-visible incident status and resolution history linked to owned events |

## Outputs To Other Modules

| Consumer | M1 provides |
|---|---|
| M2 | Immutable `EventVersion`, evidence paths, stable venue input, attendance, schedule, and event characteristics |
| M3 | Application/version records, supporting evidence, organiser ownership, and required authority list |
| M4 | Event, organiser, venue, and version identifiers for incident linking |
| M5 | Event type, dates, status, venue, and privacy-safe aggregation fields |

## Remaining Work

- Keep the event form, `EventRiskProfile`, and server validation contract synchronized.
- Add notification display when M3 creates the notifications contract.
- Add links into M4 incident pages after those routes exist.
- Confirm public calendar fields remain sanitised after any schema change.
- Add browser tests for draft, upload, submit, revision, withdrawal, and public visibility.

## Definition of Done

- An organiser can register, sign in, create, save, submit, revise, and withdraw an eligible application.
- A submitted version cannot be edited or replaced.
- Another organiser cannot read or change the application.
- Status and M2/M3 outputs update without manual refresh.
- Only approved sanitised events appear publicly.
- Owned pages pass desktop/mobile, empty/error/loading, and keyboard checks.
