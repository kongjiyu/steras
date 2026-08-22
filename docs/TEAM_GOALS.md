# STERAS Team Goals and Work Allocation

**Planning basis:** `STERAS_PRD.md`, current routes, current module contracts, and the implemented M2 v2 interface
**Working model:** one owner per module; the M2 owner also owns General integration

## Team Objective

Deliver one demonstrable end-to-end prototype in which an organiser can submit an event, M2 can assess it, authorities can review it, incidents can be reported and handled, and authorised users can inspect auditable analytics.

Each teammate owns a vertical result, not just a collection of UI screens. Their work includes the relevant types, Firebase Rules, backend behavior, UI states, tests, and module documentation.

## Current Project Progress

| Area | Current progress | Main gap |
|---|---|---|
| M1 | Auth, organiser dashboard, event form, venue selection, draft saving, uploads, submission, withdrawal, event list/detail, public calendar, public event detail, server validation, and base Rules are implemented | Full lifecycle UAT, revision-path verification, M3 notifications, M4 navigation, and broader browser coverage |
| M2 | Eight-domain HIRARC assessment, readiness/compliance/confidence, evidence snapshots, historical retrieval, MiniMax advisory/fallback, resource ranges, demo data, authority risk/resource pages, tests, and external-service verification are implemented | Contract stabilisation, M3 verified-control handoff, real M4 outcomes, authority validation of resource assumptions, and final integration |
| M3 | Authority dashboard, assigned review queue, event review, evidence download, scoped decisions, multi-authority aggregation, decision history, resource override, audit writes, and approved-event publication are implemented | Durable notifications, verified-control workflow, explicit readiness/compliance decision gates, standalone audit UX, and complete branch/UAT coverage |
| M4 | Shared incident/history fields and synthetic demo incident/history data exist for M2 testing | No production routes, pages, report/triage/assignment/verification Functions, evidence workflow, Rules contract, or end-to-end tests currently exist |
| M5 | Authority-scoped reports page, date filter, application/approval trends, risk distribution, average score, AI agreement/fallback, turnaround summary, CSV export, and unit tests are implemented | Remaining PRD filters/metrics, readiness/compliance/confidence views, resource/override/re-application charts, M4 metrics, schema metadata, bounded aggregation, and stronger export/privacy tests |
| General | Role-protected routing, layouts, navigation, shared UI, dashboard preview, module ownership documents, emulator setup, and integration scripts exist | Final cross-module navigation, contract conflict management, end-to-end release walkthrough, and coordinated deployment |

### Overall assessment

- M2 is the most complete functional module and should now be treated as a stable provider contract.
- M1 and M3 already have substantial working foundations; their owners should finish and verify existing flows instead of rebuilding them.
- M4 is the largest missing implementation and needs a focused vertical-slice build.
- M5 is a working foundation, not a blank module; its owner should extend the current analytics implementation.
- General integration should happen continuously, but final release integration depends primarily on M3 notifications and M4 data contracts.

## Immediate Goal by Owner

| Owner | Immediate goal | Demonstrable result |
|---|---|---|
| M1 teammate | Complete and verify the organiser application lifecycle | An organiser can register, create/save/upload/submit, view status, respond to a revision, withdraw when eligible, and view only sanitised approved events |
| M2 owner / General integrator | Freeze and support the all-hazards assessment contract | Every submitted version produces an explainable HIRARC result, readiness/compliance state, advisory AI result, and prototype resource ranges without breaking other modules |
| M3 teammate | Complete the human authority review and notification workflow | Assigned authorities can review, verify controls, decide with rationale, aggregate multi-agency decisions, publish approved events, and notify the organiser |
| M4 teammate | Build the incident-handling vertical slice | Organisers can report incidents; admins can decide whether action is required; assigned parties can investigate and resolve them; only eligible verified incidents become future M2 history |
| M5 teammate | Complete auditable analytics and safe export | An authorised reviewer can filter required KPIs, distinguish synthetic/missing data, and export privacy-safe data with documented formulas |

## M1 — User and Event Management

### Current progress

- All M1-owned routes and page files are registered.
- Firebase Auth organiser registration/login and role-aware access exist.
- Draft creation, verified/custom venue input, risk-profile input, document upload, immutable submission, withdrawal, live event status, and organiser event detail exist.
- Callable submission/withdrawal validation and base Firestore/Storage protection exist.
- Public calendar/detail read from the sanitised `public_events` projection.
- Component/unit coverage exists, but the complete emulator/browser lifecycle has not been demonstrated as one repeatable UAT flow.

### Current delivery goal

Turn the existing organiser pages into a verified end-to-end application lifecycle instead of adding new dashboard decoration.

### Work package

1. Synchronise `NewEvent.tsx`, `EventDetails`, `EventRiskProfile`, and `submitEvent.ts` validation.
2. Verify draft saving, version-scoped uploads, immutable submission, revision re-submission, and withdrawal.
3. Complete loading, empty, error, permission, and mobile states on all M1-owned pages.
4. Add an organiser notification presentation interface that can consume M3 notification records without implementing M3 business logic.
5. Verify that `public_events` exposes no organiser PII, private evidence, risk assessment, or incident data.
6. Add browser/UAT coverage for the complete organiser golden path and forbidden cross-organiser access.

### Acceptance evidence

- One recorded emulator walkthrough: register → draft → upload → submit → revision → resubmit.
- Submitted versions cannot be edited.
- Another organiser cannot read the event or evidence.
- Only approved sanitised events appear on public routes.
- M1 tests, Rules tests, typecheck, lint, and build pass.

### Handoff required

- Consume M2 assessment/resource records as read-only.
- Consume M3 decision and notification records as read-only.
- Provide M4 with stable event, version, organiser, and venue identifiers.

## M2 — Smart Risk Assessment and Safety Resource Recommendation

### Current progress

- The category-based v1 implementation has been migrated to the eight-domain all-hazards/HIRARC v2 contract.
- Official residual risk, readiness, compliance, confidence, evidence provenance, verified controls, comparable history, MiniMax advisory handling, and resource ranges are implemented.
- `/authority/risk`, `/authority/resources`, organiser/authority reusable M2 views, emulator demo fixtures, engine tests, Rules coverage, and external-service checks exist.
- The remaining gaps depend mainly on M3 control verification, M4 real outcomes, and real authority validation rather than another core scoring implementation.

### Current delivery goal

Stabilise the implemented v2 contract and support integration. Avoid introducing another scoring redesign unless the PRD changes.

### Work package

1. Maintain deterministic eight-domain HIRARC assessment, readiness, compliance, evidence confidence, and verified-control behavior.
2. Maintain MiniMax as advisory-only and preserve safe fallback behavior.
3. Maintain normalized historical retrieval and synthetic-data provenance.
4. Keep resource baselines and ranges explicitly labelled prototype guidance.
5. Supply M1/M3/M4/M5 with fixtures, contract examples, and integration support.
6. Own General routing, shared visual consistency, release checks, and final integration conflict resolution.

### Acceptance evidence

- Same immutable input and version configuration produces the same official result.
- AI failure cannot change or block the official deterministic result.
- Synthetic history is visibly labelled and never presented as accuracy evidence.
- `npm run check`, Rules tests, external-service verification, and emulator submission pass.

### Handoff required

- M3 supplies verified-control reviewer provenance and decision gates.
- M4 supplies verified eligible incidents and completed historical outcomes.
- M5 treats readiness, compliance, confidence, schema version, and synthetic status as separate analytics dimensions.

## M3 — Authority Approval and Notification

### Current progress

- Authority dashboard, scoped review queue, event review page, evidence download, decisions, decision history, resource override, and publication behavior exist.
- Backend aggregation already supports required-authority scope and versioned approval/rejection/amendment decisions.
- Audit records and sanitised approved-event publication are present.
- Durable notification records, verified-control actions, and explicit blocking based on M2 compliance/readiness are not implemented.

### Current delivery goal

Finish the real human-decision workflow around the existing authority pages and backend.

### Work package

1. Enforce that `complianceStatus: blocked` cannot be approved.
2. Require an explicit reviewer rationale for provisional or insufficient-data assessments.
3. Add a server-mediated control-verification action containing control ID, authority type, reviewer UID, evidence path, timestamp, and version.
4. Preserve all decisions and resource overrides by application version and authority type.
5. Implement durable, idempotent `notifications/{notificationId}` records for review progress, decisions, revision requests, and re-submission.
6. Add organiser-readable notification Rules and an M1 consumption contract.
7. Test unanimous approval, rejection precedence, revision precedence, concurrency, re-submission, permission denial, and publication sanitisation.

### Acceptance evidence

- PDRM, BOMBA, KKM, DBKL, and MOTAC accounts see only assigned applications.
- Blocked compliance cannot reach Approved.
- Only unanimous same-version approval publishes `public_events`.
- Decisions, overrides, control verification, and notifications have audit provenance.
- M3 emulator and Rules tests pass.

### Handoff required

- Do not change M2 scores or AI outputs.
- Provide M1 with stable decision and notification display fields.
- Provide M5 with decision stage, reviewer scope, timestamps, overrides, and publication outcome.

## M4 — Incident Reporting and Handling

### Current progress

- M2-compatible incident and historical-outcome fields exist in shared types.
- The emulator demo seed provides synthetic venues, historical outcomes, and incidents for retrieval testing.
- Authority-only read protection exists for the current synthetic historical evidence.
- There are no production M4 pages or registered routes, no incident triage/assignment contract in code, no incident submission/verification Functions, and no complete M4 Rules or evidence-upload workflow.

### Current delivery goal

Build the largest missing module as one complete vertical slice: reporting, admin triage, assignment, investigation, resolution, and authority verification.

### Work package — Incident Handling MVP

1. Add final incident types, collections, indexes, Firestore Rules, and Storage Rules.
2. Implement organiser incident create/list/detail pages.
3. Implement authority incident queue, action-required triage, assignment, verification, status changes, and assessment-eligibility control.
4. Store event/version/venue linkage, occurred time, severity, evidence, outcome, reporter, and reviewer provenance.
5. Expose only `status: verified` plus `assessmentEligible: true` records to future M2 retrieval.
6. Add completed-event outcome fields for attendance exposure, medical presentations, transfers, resources used, interruptions, near misses, and after-action findings.
7. Require a recorded justification when the admin closes a report with no further action.
8. When action is required, let the assigned organiser or authority record response actions, investigation findings, evidence, and final outcome.
9. Emit notification requests for assignment, material updates, and final resolution.

### Acceptance evidence

- Organisers can access only records linked to events they own.
- Authorities can act only within their assigned scope.
- Evidence is private and versioned.
- Unverified, rejected, future, or ineligible incidents never enter M2 history.
- Incident triage, assignment, investigation, and status histories are auditable.

### Handoff required

- Consume M1 identifiers and M3 authority scope.
- Provide M2 with the verified historical projection.
- Provide M5 only privacy-safe dimensions and timestamps.

## M5 — Analytics and Reporting

### Current progress

- `/authority/reports` is implemented and scoped by the signed-in authority type.
- The page currently provides date filtering, application/approval monthly trends, official-risk distribution, monthly average official score, AI agreement, fallback rate, turnaround summary, and CSV export.
- CSV cells already receive basic spreadsheet-formula neutralisation.
- Current reads are client-side and the remaining PRD filters, resource/override/re-application metrics, M4 metrics, schema metadata, and synthetic-data exclusion are not complete.

### Current delivery goal

Turn the current analytics foundation into an auditable PRD-complete reporting page.

### Work package

1. Document every metric formula, source fields, denominator, exclusions, unavailable rule, and schema-version behavior.
2. Add submission, status, residual-risk, readiness, compliance, confidence, resource, override, decision, turnaround, and re-application views.
3. Add AI-success/fallback coverage and AI-vs-deterministic agreement without implying that AI makes decisions.
4. Add incident action-required, verification, severity/status, and resolution metrics behind a clear “data available” state until M4 delivers its contract.
5. Exclude synthetic records from operational KPIs by default and provide an explicit demo-data filter.
6. Add date, event type, venue, risk, application status, authority scope, and schema-version filters.
7. Extend and test the existing CSV export for complete PII exclusion, schema metadata, active filters, and spreadsheet-formula neutralisation.
8. Replace unbounded client reads with bounded queries or server-generated snapshots where required.

### Acceptance evidence

- Every PRD metric is either correctly displayed or explicitly marked unavailable with a reason.
- Low confidence or insufficient evidence is never counted as Low risk.
- Results are authority-scoped, schema-version aware, reproducible, and privacy-safe.
- Export tests prove that PII and formula injection are excluded.

### Handoff required

- Treat every upstream module as read-only source data.
- Do not introduce business decisions based on analytics output.

## File Ownership and Conflict Rules

1. The owner listed in `docs/GENERAL.md` owns each page file.
2. Module-specific components belong under that module’s folder.
3. Cloud Functions that make a module decision belong to that module owner.
4. Before editing `shared/types.ts`, announce the fields and owner because every module consumes this file.
5. Do not change another module’s stored contract without updating both module documents and notifying the consumer.
6. General integration may resolve routing and shared-UI conflicts but must not silently change module business rules.

## Recommended Integration Order

1. M1, M3, M4, and M5 begin independently using the existing demo dataset and typed contracts.
2. M3 publishes the notification and verified-control interfaces.
3. M4 publishes the verified-incident and completed-outcome interfaces.
4. M1 connects notification and M4 navigation.
5. M5 connects real M3/M4 fields while retaining explicit unavailable states.
6. General runs full end-to-end integration and release gates.

## Shared Definition of Done

- The PRD requirement IDs owned by the module are traceable to code and tests.
- Auth and Rules reject cross-user, cross-authority, and public access outside the contract.
- Loading, empty, error, permission, mobile, and keyboard states are present.
- No real API key, personal data, or service-account file is committed.
- `npm run check` and `npm run test:rules` pass before integration.
- The owner provides one short emulator demo script or recorded walkthrough for handoff.
