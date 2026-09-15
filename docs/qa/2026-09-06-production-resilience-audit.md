# STERAS production QA / QC — 2026-09-06

## Decision

**Released with one operational data follow-up.** The 6 September audit originally found the reviewed fixes only in the working tree. The reviewed source set was subsequently published on 8 September 2026 as commit `a29a1f8`; the six inconsistent venue records in QC-01 still require owner-backed correction and reverification.

Statements below that say a source fix was "not deployed" record the state observed on 6 September. The release record at the end of this document supersedes them.

- Production: https://linkos-496505.web.app (`linkos-496505`).
- Source at the start of the audit: `main`, HEAD `9b908b2`, with substantial pre-existing uncommitted frontend, backend and generated-file changes.
- Scope authority: `STERAS_PRD.md`, `docs/modules/M1_USER_EVENT_MANAGEMENT.md` through M5, and the current code.
- Authenticated production accounts: Admin reviewer, Organizer 1, PDRM, BOMBA, KKM and DBKL showcase reviewers. Credentials are intentionally omitted.
- Local browser verification: `http://127.0.0.1:5175`, current source, **real production Firebase services**, with `VITE_USE_FIREBASE_EMULATOR=false` supplied only to the process. This is not a separate staging environment.
- Initial localhost sessions used emulator configuration. Their stopped services also exercised the new recoverable profile-failure screen; they were not used to claim production data passes.
- Business records were not submitted, approved, deleted, reset or changed by this audit. Production negative callable requests were malformed/unauthorised and rejected. Fault injection affected only the test browser. Report generation/export is read-only.

## Findings and disposition

| ID | Priority | Finding and reproduction | Disposition / evidence |
|---|---|---|---|
| QA-01 | P1 | All four authority accounts reach `/authority/applications` but receive **Queue unavailable**, while their dashboards and assessment/resource portfolios load. | Existing, pre-audit local query simplification in `ReviewQueue.tsx` was preserved and verified against production Firebase: All 4 / Pending 1 / Under Review 3. No new rule relaxation. Precise production failure code is not surfaced by that deployed page; an index/query mismatch is a hypothesis, not a confirmed backend diagnosis. **Not deployed.** |
| QA-02 | P1 | `/admin/applications/qa-nonexistent-20260906/assign` remains **Loading application...** with uncaught Firestore permission errors. Missing documents are also indistinguishable from loading. | Added explicit loading, missing and failed states; retry; assignment/checklist failure gate; stale checklist response cancellation. Browser now shows **Assignment workspace unavailable** with retry for the denied path. Unit tests also verify a readable missing document ends loading. |
| QA-03 | P1 | M4 submission creates a new UUID on every attempt. If the server succeeds but its response is lost, retry can create another incident despite server idempotency support. | Preserve key for the same form/evidence signature, rotate after edits, and guard concurrent submission with a ref. Regression verifies unchanged retry reuses the key and an edited request rotates it. No real duplicate incident was created. |
| QA-04 | P2 | M4 initially displays zero records before its read finishes; failed reads have no retry. A successful write followed by a failed refresh enters the write error catch. | Distinct loading and unavailable states, retry, disabled actions during unavailable data, refresh failures separated from submission failures, and selection reconciled with refreshed records. Browser-injected 503 disables submission; retry restores eight accessible records. |
| QA-05 | P2 | M4 client accepts a future occurrence or a time before the selected event if other fields are populated. | Validate against selected event start/end and current time; explain the invalid date beside the form; disable submission. Unit tests cover future/pre-event dates; browser verified year 2999 is blocked without a write. |
| QA-06 | P1 | Profile read failures are swallowed and interpreted as an unassigned account. A pending read can restore an old profile after sign-out; an indefinitely pending read can hold the initial loading screen. | Bounded 15-second profile read, explicit retryable error, generation guards and recovery action. Unit tests cover failure/retry, late resolution after sign-out and a never-resolving request. Real Admin/Organizer/PDRM login re-tested successfully. |
| QA-07 | P2 | Organizer control evidence and Admin Stage 2 child-list failures only log to console, potentially displaying missing submissions or retaining actions without current evidence. Public projection failures also resemble no published evidence. | Display blocking/retryable errors on organizer/admin control pages and a separate public evidence error; retry resubscribes. Tests cover both private pages and public projection failure/recovery. |
| QA-08 | P2 | No root React error boundary: a render exception can leave the app blank. | Added recovery page with reload/home actions and guidance to verify a recent action before retrying. Regression injects a render exception and confirms private exception text is not rendered. |
| QA-09 | P2 | Turning the production browser offline leaves the cached calendar count visible with no connection warning. | Added global offline/reconnection status. Browser and component tests verify the banner; it does not claim to detect every service outage. |
| QA-10 | P2 | Calendar and M5 initial/error states can display zero as an apparent confirmed count. M5 Generate remains enabled before load completes; reversed dates can produce a misleading empty report. | Calendar count becomes unavailable on error; M5 loading/error counts are explicit; Generate is gated by loading/error/range validity. Browser verifies reversed dates are blocked with explanation. |
| QA-11 | P2 | Incident action/directory controls lack accessible names. Switching incident details can retain the previous incident's response form state. Sign-out failure on the login session screen rejects without user feedback. | Added accessible labels, keyed detail state by incident, and handled login-screen sign-out errors. |
| QA-12 | P2 | Production `/admin/audit` is still a placeholder saying the aggregated view will be built later. | An implemented audit view already existed in the initial uncommitted changes. Preserved; not claimed as authored by this audit. Production still needs the intended frontend release. |
| QC-01 | P1 | Production venue records marked verified have inconsistent state/address pairs: Axiata Arena, Bukit Jalil National Stadium and Dataran Merdeka show KL addresses but Selangor; Penang Esplanade and PISA Penang show Penang addresses but Selangor; Sutera Harbour Resort shows Kota Kinabalu address but Selangor. | **Open data-quality issue.** Officer assignment uses canonical venue state. Reconcile these six records with the venue owner/source, then apply the normal edit/reverification workflow and inspect affected application bindings. No source of these exact incorrect production values was established in this audit. Do not silently rewrite submitted versions or mark the data reverified. |

## Executed coverage

| Area | Current-run evidence | Boundary |
|---|---|---|
| Public | Landing/calendar rendering; eight approved listings; mobile screenshot; unmatched search; missing listing; invalid email; offline simulation | No registration or public confirm/report write |
| M1 | Organizer login, dashboard, event list, template journey, application form and incident entry; wrong-role navigation; invalid submit payload rejected | No new full document extraction/submission or revision/cancellation lifecycle in production |
| M2 | All four authority dashboards and risk/resource registers inspected; fixed-source queue loads same production data | AI timeout, unavailable/invalid output and retry behavior covered by backend tests, not a live provider outage |
| M3 | Admin dashboard/application/user/venue/audit routes; all four officer queues; invalid assignment path; callable role denial; private/public evidence failure regressions | No real officer decision, password reset, publishing or reassignment |
| M4 | Six roles' incident route reads; existing history; malformed request guards; read 503/recovery; invalid client date; idempotent retry tests | No synthetic incident written to production, no destructive state-transition test on existing incidents |
| M5 | Production analytics loads 14 records, including 12 identified presentation records; current-source five report views generate; control-compliance CSV download; invalid date range blocked | CSV spot-check excludes account emails, private evidence paths and the inspected incident narrative. This is not an exhaustive privacy proof or PDF pagination audit |
| Mobile | 390×844: Organizer events/templates/details/incidents (4), authority dashboard/queue/risk/resources/incidents (5), Admin dashboard/applications/users/venues/analytics/incidents (6) | All 15 have document width 390; screenshots visually inspected for organizer/authority/admin incident screens and public calendar. Not every screen received full visual or keyboard audit |
| Security | Firestore/Storage emulator rules, role routing and selected live callable denials | Not a penetration test, load test, exhaustive endpoint fuzzing or cross-browser certification |

### Selected live negative calls

All below used the Organizer account and made no successful business write:

| Callable | Input | Observed result |
|---|---|---|
| `submitIncident` | `{}` | `functions/invalid-argument`: Invalid incident category |
| `submitEvent` | `{}` | `functions/invalid-argument`: eventId is required |
| `manageIncident` | `{}` | `functions/invalid-argument`: incidentId is invalid |
| `makeInitialReviewDecision` | `{}` | `functions/invalid-argument`: eventId is required |
| `getAnalyticsPortfolio` | `{}` | `functions/permission-denied`: administrators only |
| `createPrivilegedAccount` | `{}` | `functions/permission-denied`: authorised administrator required |
| `resetUserPassword` | `{}` | `functions/permission-denied`: authorised administrator required |

Two initial diagnostic calls used incorrect endpoint names (`initialReview`, `adminCreateUser`) and returned `functions/internal`. They were replaced with the actual exported names above and are **not application defect evidence**.

### Automated verification

- Baseline before audit edits: `npm run check` passed; frontend 42 files / 172 tests.
- Final `npm run check`: **PASS** — typecheck, lint, frontend **46 files / 186 tests**, functions **48 files / 334 tests**, and both builds.
- `npm run test:rules`: **PASS**, Firestore/Storage emulator **2 files / 91 tests**, project `steras-test`.
- `git diff --check`: PASS.
- Fourteen additional frontend regression cases. Backend and rule code were not changed by this audit.
- Build regenerates tracked `functions/lib` files. Many generated differences and source changes were already present at start; no commit, staging, reset or deployment was performed.

## Evidence files

Under `output/playwright/`:

- `qa-calendar-mobile-before.png`
- `qa-production-organizer-mobile.png`
- `qa-production-authority-mobile.png`
- `qa-production-admin-mobile.png`
- `qa-local-queue-after.png`
- `qa-local-assignment-error-after.png`
- `qa-local-incidents-error-after.png`
- `qa-local-invalid-incident-after.png`
- `qa-local-offline-after.png`
- `qa-local-controls-report.csv` — internal export QA evidence

The earlier `docs/presentation/STERAS_M1_M5_E2E_RESULTS.md` records a completed M4 loop as well as M1–M3/M5. That is historical evidence. This audit did not rerun that full mutable production lifecycle.

## Release follow-up — 2026-09-08

- Reviewed release `a29a1f8` was pushed to `origin/main`.
- Firebase Hosting and the affected functions `onEventCreated`, `onEventUpdated`, `submitAuthorityScoreReview`, `resolveAuthorityScoreConflict`, and `retryOfficialFinalisation` deployed successfully to project `linkos-496505` in `asia-southeast1`.
- The final release check passed TypeScript, ESLint, frontend and Functions builds, frontend **50 files / 198 tests**, and Functions **48 files / 335 tests**.
- Firestore and Storage emulator rules passed **3 files / 95 tests**.
- Authenticated production smoke testing confirmed `/admin/audit` loads the implemented audit trail with **103 records**, search, record-type filters, actor details, and application links. Its desktop layout was visually inspected at 1440×900.
- Local browser captures, the UI-feedback workspace, credentials, and regenerated `functions/lib` output were excluded from the commit. New local captures are ignored by `.gitignore`; the curated `output/playwright/production-m1-m5/` evidence remains tracked.
- The proposed removal of synthetic-data controls and disclosure from analytics was rejected during review, so the disclosure remains visible and synthetic provenance remains present in exports.
- The incomplete BOMBA account edit was rejected; the documented account remains `bomba.showcase@steras.test`.

QC-01 remains open: reconcile and reverify the six venue records, then inspect affected assignment and application scope. A fresh full production acceptance claim still requires a clearly designated event to rerun submission → assessment → officer decisions → publication → incident response/resolution → analytics; this audit's rejected requests and unit tests do not replace that evidence.
