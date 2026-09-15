# M5 — Analytics and Reporting

**Owner:** Module 5 teammate

**PRD requirements:** FR-M5-01 to FR-M5-20

## Goal

Provide privacy-safe, auditable operational analytics across submissions, official risk, resources, decisions, reviews, incident handling, and re-applications.

M5 observes source records. It never changes an assessment, resource recommendation, incident, or authority decision.

## Current Progress

- The admin-only, read-only `/admin/analytics` page is implemented inside the shared admin shell. The retired `/authority/reports` path redirects to the Authority dashboard and does not grant M5 access.
- `/dashboard-preview?view=reports` provides a design-review version with representative data.
- `getAnalyticsPortfolio` provides one bounded, admin-only Cloud Functions read model for the live dashboard. It replaces browser-side full collection reads and per-event assessment requests.
- The API returns only M5-safe fields: event identity and scope, assessment summaries, resource aggregates, incident counters, control counters, terminal timestamps, and re-application signals. It does not return organiser contact details, evidence paths, incident descriptions, authority rationale, or private notes.
- Synthetic/UAT fixtures are identified and excluded by default. API responses include schema version, metric-definition version, generation timestamp, source cutoff, truncation state, and unavailable-section metadata.
- The page provides five report modes, date filtering, event-type scope, application/approval trends, official-risk distribution, assessment-quality signals, review outcomes, operations summaries, explicit unavailable states, and CSV/PDF export as a foundation for the PRD reports.
- Analytics calculation helpers and unit tests exist, and CSV cells receive basic spreadsheet-formula neutralisation.
- Remaining UI gaps are exposing every backend filter in the report builder, richer PDF formatting, and displaying full M4 metrics once Module 4 supplies production incident data.

## Current Delivery Goal

Turn the existing reports foundation into an auditable, privacy-safe dashboard with documented formulas, required filters, explicit unavailable states, synthetic-data separation, and safe CSV export. See `docs/TEAM_GOALS.md`.

## Owned Pages

| Route | Page | Responsibility |
|---|---|---|
| `/admin/analytics` | `pages/admin/AdminAnalytics.tsx` with `pages/authority/Analytics.tsx` | Admin-shell integration, filters, KPIs, charts, trends, and CSV/PDF export |
| `/dashboard-preview?view=reports` | `pages/authority/Analytics.tsx` | Design-review preview with representative data |

`/authority/reports` redirects to `/authority`; authenticated Authority users cannot access M5. If the page becomes too large, M5 may add nested routes below `/admin/analytics/*`. M5 must update `docs/GENERAL.md` before adding them.

## Owned Code and Data

- `frontend/src/pages/authority/Analytics.tsx`
- `frontend/src/pages/authority/analyticsData.ts` and tests
- `functions/src/http/getAnalyticsPortfolio.ts`
- future `analyticsSnapshots/{snapshotId}` records
- metric definitions, schema-version grouping, and export contracts

## Firebase Backend Contract

The frontend calls the regional callable Function `getAnalyticsPortfolio`. The Function:

1. requires Firebase Authentication;
2. reads `users/{uid}` and permits only `role: admin`;
3. applies a maximum response limit of 500 events and a maximum date range of five years;
4. supports date, event type, status, venue, risk, authority, assessment schema, and synthetic-data filters;
5. reads only the current event generation plus bounded supporting collections;
6. returns the privacy-safe contract in `shared/analytics.ts`.

No new client-readable analytics collection is introduced, so Firestore Rules and composite indexes are not expanded for M5. Firebase Admin access remains inside the callable Function. Deploy the backend only after review:

```bash
firebase deploy --only functions:getAnalyticsPortfolio
```

Until the Function is deployed, use `/dashboard-preview?view=reports` for a no-authentication design preview.

General owns chart primitives only if they are genuinely reusable outside M5.

## Locked Metric Contract v1

The initial dashboard must provide:

- application submission and status trends;
- official Low/Medium/High risk distribution;
- average official score grouped by assessment schema version;
- resource recommendation and authority override trends;
- approval/rejection/revision outcomes and turnaround time;
- re-application rate;
- incident action-required rate, verified-incident rate, severity/status distribution, and resolution trends when M4 exists;
- AI vs Deterministic Category Agreement Rate;
- AI vs Final Category Agreement Rate only when M3 stores a distinct final human category.

Agreement metrics are monitoring signals only. They never modify official M2 output or M3 decisions.

## Locked Calculation Assumptions

- AI vs deterministic agreement compares `aiAdvisory.overallBand` with `officialRiskLevel` for records where M3 succeeded.
- AI fallback/invalid records are excluded from the agreement denominator and reported separately.
- The prototype currently has no separate human final risk category; therefore AI vs final agreement is Not Available until M3 adds one.
- Trends must group or filter by `categorySchemaVersion`, `scoringLogicVersion`, `formulaVersion`, and `guidelineVersion` when values differ.
- Turnaround is measured from submitted timestamp to terminal decision timestamp.
- Re-application means an event reaches version 2 or later after Rejected or Revision Requested.
- Resource override rate compares the baseline M2 recommendation with M3 override history, not only the latest document.

## Privacy and Access Assumptions

- Only authenticated Admin users may query M5. Authority is an Admin-selectable report filter, not an authorization role for this module.
- CSV/PDF exports exclude organiser name, email, phone, evidence paths/content, incident descriptions, and private investigation notes.
- Spreadsheet exports neutralise formula-leading values.
- Public users cannot access analytics records or exports.
- Synthetic fixtures are excluded from operational results by default and must be explicitly requested and labelled when shown.
- Snapshot records store the metric definition/version and source cutoff so results are reproducible.

## Inputs From Other Modules

| Provider | M5 consumes |
|---|---|
| M1 | Event type, venue, dates, versions, status, submission/update timestamps, and authority scope |
| M2 | Official residual matrix/band, dominant hazard domain, readiness, compliance, evidence confidence, synthetic-history flag, AI status, resource ranges, and formula/guideline versions |
| M3 | Decisions, review stages, timestamps, authority type, overrides, and publication state |
| M4 | Privacy-safe incident status, action-required flag, severity/category, verification, and resolution timestamps |

## Outputs To Other Modules

M5 provides read-only metrics and exports. Other modules may link to filtered reports but must not depend on a chart result for business logic.

## Remaining Work

- Keep synthetic demo records excluded from operational KPI defaults and show them only under an explicit demo-data filter.
- Report assessment coverage and missing-data rates separately from risk distribution; low-confidence or insufficient assessments are not “low risk”.
- Expose the backend venue, risk, status, authority, synthetic-data, and schema-version filters in the report builder UI.
- Complete every FR-M5-05–13 metric only when its source fields exist; otherwise show `Data Not Available` and document the missing source contract.
- Make partial/truncated coverage prominent in every affected report and export.
- Add server-generated `analyticsSnapshots` only if production volume outgrows the bounded callable read model.
- Add AI agreement coverage for success, fallback, missing, and schema-version cases.
- Add export tests for privacy and spreadsheet-injection safety.

## Definition of Done

- Every PRD metric has a documented formula, source fields, denominator, and unavailable-data rule.
- Results are scoped, privacy-safe, reproducible, and schema-version aware.
- Agreement metrics are visibly monitoring-only.
- Filters cover date range, event type, venue, official risk, status, and authority scope.
- CSV/PDF output contains no restricted fields.
- The reports page passes desktop/mobile, empty/error/loading, and keyboard checks.
