# M4 — Incident Reporting and Handling

**Owner:** Module 4 teammate

**PRD requirements:** FR-23 to FR-27

## Goal

Own the complete during-event/post-event incident lifecycle: reporting, admin triage, assignment, investigation, resolution, and authority verification. Provide M2 with a safe historical-incident projection without allowing unverified reports to alter official scoring.

No production M4 pages or complete backend workflow currently exist. The contract below is the implementation starting point.

## Current Progress

- Shared M2-compatible incident and historical-outcome fields exist.
- Synthetic demo incidents and completed outcomes are available for M2 retrieval testing.
- Current historical evidence is authority-readable and server-written.
- Production incident routes, pages, Functions, triage fields, evidence paths, complete Rules, notification integration, and end-to-end tests are not implemented.

## Current Delivery Goal

Build one vertical incident-handling slice. An organiser submits a report; an authorised admin decides whether action is required. A no-action report is closed with justification. An action-required report is assigned, investigated, resolved, and may then be verified as eligible future M2 evidence.

## Owned Pages

| Route | Planned page | Responsibility |
|---|---|---|
| `/organizer/incidents` | Organiser incident list/detail | View status and resolution history for reports linked to owned events |
| `/organizer/incidents/new` | Incident report form | Submit category, severity, description, location, occurrence time, and evidence |
| `/authority/incidents` | Authority incident queue/detail | Triage, assign, investigate, resolve, verify, and control assessment eligibility |

M4 owns the full files for these routes and the module-specific components they use.

## Locked Incident Contract v2

Create `incidents/{incidentId}` with:

- `incidentId`, `eventId`, `eventVersionId`, and stable `venueId`;
- `eventType` snapshot;
- reporter UID and reporter role;
- category, severity, description, occurred time, submitted time, location text, and optional coordinates;
- private evidence paths;
- status: `Submitted`, `UnderReview`, `ActionRequired`, `Investigating`, `Resolved`, or `Closed`;
- optional `actionRequired`, triage justification, admin UID, and triage timestamp;
- optional assigned authority type, assigned reviewer UID, and assignment timestamp;
- response actions, investigation findings, outcome, and resolution timestamp;
- `verified` and `assessmentEligible` booleans controlled only by an authorised authority;
- verification reviewer/timestamp, created timestamp, and updated timestamp.

Only records with `verified: true` and `assessmentEligible: true` may feed future M2 assessments. Demo incidents are explicitly `synthetic: true`; they support emulator testing and must never be described as real incidents at a named venue.

Incident updates never retroactively change an already stored M2 assessment. They affect only a newly submitted version or an explicit M2 recompute with a new input hash.

## Triage Rules

- Every new report enters `Submitted` and then `UnderReview` when an authorised admin begins triage.
- If `actionRequired: false`, the admin records a justification and closes the report.
- If `actionRequired: true`, the admin assigns the report to the relevant event organiser or authority officer and the status becomes `ActionRequired` or `Investigating`.
- The assigned party records response actions, evidence, findings, and the final outcome before resolution.
- Resolution does not automatically make a record eligible for M2. Verification and assessment eligibility are separate authority-controlled actions.

## Access Assumptions

- Organisers may create reports only for events they own and read only their linked incident records.
- Assigned authorities may read and update records only within their authority scope.
- The public has no access.
- Evidence uses separate versioned Storage paths and the same file-size/type restrictions as event evidence.
- Triage, assignment, verification, and assessment eligibility are server-mediated or rule protected.
- Every material status change creates an audit entry and an M3 notification request.

## Inputs From Other Modules

| Provider | M4 consumes |
|---|---|
| M1 | Event/version IDs, organiser ownership, venue ID, event type, and event dates |
| M3 | Authority identity/scope and notification delivery |

## Outputs To Other Modules

| Consumer | M4 provides |
|---|---|
| M1 | Organiser-visible incident status and resolution history |
| M2 | Verified assessment-eligible incident projection: ID, stable venue/event/version IDs, event type, severity, occurred date, outcomes, verification provenance, and after-action eligibility |
| M3 | Authority triage, assignment, and investigation queues |
| M5 | Privacy-safe incident counts, action-required rate, severity/status distributions, verification rate, and resolution times |

## Implementation Order

1. Add shared incident types, indexes, and Firestore/Storage Rules tests.
2. Add organiser incident report/list/detail pages.
3. Add authority triage and assignment actions with audit provenance.
4. Add investigation, response-action, evidence, and resolution workflow.
5. Add authority verification and assessment-eligibility controls.
6. Expose the verified incident projection to M2 and add eligibility tests.
7. Connect M3 notifications and M5 aggregation fields.
8. Add completed-event outcomes for normalized historical retrieval.

## Definition of Done

- Organisers and scoped authorities can create/read only permitted records.
- Admin can record a defensible action-required/no-action triage decision.
- Action-required reports can be assigned, investigated, and resolved.
- Evidence is private and versioned, and status history is auditable.
- Only verified eligible incidents affect future M2 context.
- Existing M2 assessments never change silently or retroactively.
- Every owned page covers loading, empty, error, permission, mobile, and keyboard states.
