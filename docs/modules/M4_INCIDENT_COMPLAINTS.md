# M4 — Incident Reporting and Complaint Handling

**Owner:** Module 4 teammate

**PRD requirements:** FR-23 to FR-27

## Goal

Own during-event/post-event incident reporting and the complaint ticket lifecycle. Provide M2 with a safe, stable historical-incident projection without allowing complaints or unverified reports to alter official scoring.

No production M4 pages or complete backend workflow currently exist. The contracts below are the implementation starting point.

## Current Progress

- Shared M2-compatible incident and historical-outcome fields exist.
- Synthetic demo incidents and completed outcomes are available for M2 retrieval testing.
- Current historical evidence is authority-readable and server-written.
- Production incident/complaint routes, pages, Functions, complaint types, evidence paths, complete Rules, notification integration, and end-to-end tests are not implemented.

## Current Delivery Goal

Build two vertical slices in order: first the incident reporting and authority-verification MVP, then the complaint ticket MVP. Only verified assessment-eligible incidents may become future M2 evidence. See `docs/TEAM_GOALS.md`.

## Owned Pages

| Route | Planned page | Responsibility |
|---|---|---|
| `/organizer/incidents` | Organiser incident list | View reports linked to owned events |
| `/organizer/incidents/new` | Incident report form | Details, location, time, severity, and evidence |
| `/organizer/complaints` | Complaint list/form | Submit and track owned complaint tickets |
| `/authority/incidents` | Authority incident queue/detail | Validate, investigate, update status, and mark assessment eligibility |
| `/authority/complaints` | Authority complaint queue/detail | Assign ticket, investigate, respond, and close |

M4 owns the full files for these routes and the module-specific components they use.

## Locked Incident Contract v1

Create `incidents/{incidentId}` with:

- `incidentId`, `eventId`, `eventVersionId`, and stable `venueId`;
- `eventType` snapshot;
- reporter UID and reporter role;
- occurred time, submitted time, location text, and optional coordinates;
- details and evidence paths;
- severity: Low, Medium, or High;
- status: Submitted, UnderReview, Verified, or Closed;
- `assessmentEligible` boolean controlled only by an authority;
- verification reviewer/timestamp and updated timestamp.

Only incidents with `status: verified` and `assessmentEligible: true` may feed future M2 assessments. Demo incidents are explicitly `synthetic: true`; they support emulator testing and must never be described as real incidents at a named venue.

Incident updates never retroactively change an already stored M2 assessment. They affect only a newly submitted version or an explicit M2 recompute with a new input hash.

## Locked Complaint Contract v1

Create `complaints/{complaintId}` with:

- complainant UID;
- linked event/application ID where applicable;
- category, details, and evidence paths;
- status: Submitted, Open, Investigating, AwaitingResponse, Resolved, or Closed;
- assigned authority type and optional assigned reviewer UID;
- privacy-safe public update plus private authority notes kept separately;
- created, updated, and resolved timestamps.

Complaints never enter M2 scoring directly. If an investigation confirms an incident, M4 creates or links a separate verified incident record.

## Access Assumptions

- Organisers may create reports only for events they own and read only their own incidents/complaints.
- Assigned authorities may read and update records within their authority scope.
- The public has no access.
- Evidence uses separate versioned Storage paths and the same file-size/type restrictions as event evidence.
- Authority verification, assessment eligibility, assignment, and final response are server-mediated or rule protected.
- Every material status change creates an audit entry and an M3 notification request.

## Inputs From Other Modules

| Provider | M4 consumes |
|---|---|
| M1 | Event/version IDs, organiser ownership, venue ID, event type, and event dates |
| M3 | Authority identity/scope and notification delivery |

## Outputs To Other Modules

| Consumer | M4 provides |
|---|---|
| M1 | Organiser-visible incident/complaint state and public-safe responses |
| M2 | Verified assessment-eligible incident projection: ID, stable venue/event/version IDs, event type, severity, occurred date, outcomes, verification provenance, and after-action eligibility |
| M3 | Authority investigation queues and escalation links |
| M5 | Privacy-safe counts, severity/status distributions, resolution times, and complaint trends |

## Implementation Order

1. Add shared types and Firestore/Storage Rules tests.
2. Add organiser incident report/list pages.
3. Add authority incident verification queue.
4. Expose the verified incident projection to M2 and add eligibility tests.
5. Close each completed event with attendance, attendee-hours, resources actually used, patient presentations, transfers, interruptions, near misses, and after-action findings for normalized historical retrieval.
6. Add complaint submission and authority ticket workflow.
7. Connect M3 notifications and M5 aggregation fields.

## Definition of Done

- Organisers and scoped authorities can create/read only permitted records.
- Evidence is private and versioned.
- Incident and complaint histories are auditable.
- Only verified eligible incidents affect future M2 context.
- Complaints cannot directly change risk scores or decisions.
- Every owned page covers loading, empty, error, permission, mobile, and keyboard states.
