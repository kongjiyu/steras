# STERAS End-to-End Implementation Plan

**Plan version:** 1.0  
**Start date:** 13 July 2026  
**Final delivery:** 17 September 2026  
**Source of truth:** `steras-prd.md` v2.1

## 1. Delivery Goal

Deliver a tested Firebase SPA in which an organizer can submit and revise an event application, the server can calculate an auditable baseline risk and validated MiniMax M3 adjustment, required authorities can make version-specific decisions, and the public can view only fully approved events.

The MVP is complete only when the full workflow runs against Firebase Emulator Suite and the deployed staging project. Visual mock data does not count as a completed workflow.

## 2. Current Baseline

**Sprint status (14 July 2026):** Phases 1-4 and the Phase 5 authority workflow core are complete. Staging Firebase is deployed; browser UAT still requires provisioned organizer and authority test accounts.

Already present:

- React/Vite frontend, role-based pages, Firebase configuration, and an authority dashboard design.
- Cloud Functions for rule scoring, AI scoring, resources, decisions, weather, holidays, and audit logs.
- Firestore/Storage rules, seed data, shared types, analytics scaffolding, and public pages.
- TypeScript checks and production builds currently pass.

Required migration before feature expansion:

- Replace the old independent AI score/disagreement model with PRD v2.1's baseline plus bounded adjustment model.
- Add immutable application versions, multi-authority decisions, and server-mediated transitions.
- Align risk thresholds, event fields, collections, analytics, documentation, and UI wording.
- Add the missing ESLint configuration and automated tests.

## 3. Working Agreement

- Use short branches named `codex/feat-*`, `codex/fix-*`, or equivalent team branches.
- Keep pull requests focused on one phase or vertical capability.
- Use Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- A PR requires a summary, linked requirement, screenshots for UI work, migration notes, and commands run.
- Never merge when typecheck, lint, unit tests, emulator tests, or production build fails.
- Freeze shared contracts before parallel frontend/backend work begins.

## 4. Architecture Contract

```text
Organizer submission
  -> immutable application version
  -> contextual data snapshot
  -> deterministic baseline
  -> MiniMax-M3 bounded adjustment proposal
  -> server validation and final score
  -> deterministic resources
  -> multi-authority review
  -> public publication after unanimous required approval
```

The server owns assessment, resource, decision, status, role, publication, and audit writes. The client submits commands and displays server records. AI never calculates the authoritative final score or resource quantities.

## 5. Delivery Phases

### Phase 0 - Baseline and Team Setup (13-15 Jul) - Core Complete

**Lead:** Project Manager | **Support:** Programmer, Tester

- Create Firebase development and staging projects and confirm billing/quota policy.
- Register frontend apps and configure local `.env` files from examples.
- Configure Auth, Firestore, Storage, Functions, Hosting, and Emulator Suite.
- Add ESLint configuration, Vitest, React Testing Library, and Functions test tooling.
- Add CI for install, typecheck, lint, test, and build.
- Create a requirements traceability table from PRD acceptance criteria to tests.
- Record the current UI and emulator workflow as the migration baseline.

**Exit gate:** A fresh clone installs successfully; CI runs; emulators start; build and a smoke test pass without production secrets.

**Environment status:** Firebase project `linkos-496505` is configured as STERAS with Singapore Firestore, Storage, Node 22 Functions, Auth, Hosting, Secret Manager, and Blaze billing. The deployed staging smoke test passes at `https://linkos-496505.web.app`.

### Phase 1 - Contracts and v2.1 Architecture Migration (16-22 Jul) - Complete

**Lead:** Programmer | **Support:** Requirement Lead

- Redesign `shared/types.ts` around `EventVersion`, `RiskAssessment`, `ResourceRecommendation`, `AuthorityDecision`, and `AuditLog`.
- Add `Draft` and processing states or fields required to distinguish assessment progress from review status.
- Standardize Low `0-39`, Medium `40-69`, and High `70-100` everywhere.
- Remove `AIRiskScore`, disagreement fields, AI resource suggestions, and old UI terminology.
- Define collection paths, document IDs, idempotency keys, and server timestamps.
- Update `docs/MODULE_MAPPING.md` and `README.md` to match PRD v2.1.
- Create a migration/seed reset strategy; prototype data may be reseeded instead of migrated in place.

**Exit gate:** Frontend and Functions compile against one shared schema; no old independent-AI-score or disagreement behavior remains.

### Phase 2 - Authentication, Roles, Drafts, and Event Versions (23 Jul-2 Aug) - Core Complete

**Lead:** Requirement Lead | **Support:** Programmer, Project Manager

- Restrict public signup to organizer accounts; provision authority roles through a seed/admin process.
- Complete organizer profile, sign-in, sign-out, loading, unauthorized, and password-reset states.
- Build draft create/edit/delete, submission validation, withdrawal, amendment edit, and resubmission.
- Add all PRD fields: coordinates, environment, coverage, seating, private contact fields, and emergency-plan summary.
- Implement document upload with progress, type/size validation, listing, and removal before submission.
- On submission, create an immutable version and enqueue assessment server-side.
- Make organizer event lists and details read real Firestore data with empty, loading, error, and stale states.

**Exit gate:** Emulator test proves an organizer can create a draft, upload evidence, submit version 1, withdraw when allowed, and submit version 2 after an amendment without altering version 1.

### Phase 3 - Deterministic Assessment Pipeline (3-9 Aug) - Complete

**Lead:** Programmer | **Support:** Requirement Lead, Tester

- Refactor the five sub-scorers and store raw scores, weighted contributions, evidence keys, source timestamps, and `ruleVersion`.
- Resolve venue history by stable `venueId`, not venue name.
- Version Malaysian holiday data and define weekend/holiday proximity behavior.
- Integrate OpenWeather by coordinates with timeout, retry, cache, fallback, and freshness status.
- Use assessment-version IDs and input hashes to make triggers idempotent.
- Store one active assessment per application version while preserving historical attempts.
- Add unit tests for every threshold, boundary, missing context, and weighted calculation.

**Exit gate:** Identical version inputs always produce the same baseline; duplicate events do not create duplicate active assessments; all score boundaries are tested.

### Phase 4 - MiniMax M3 Refinement (10-16 Aug) - Core Complete

**Lead:** Programmer | **Support:** Design Lead, Tester

- Configure `MINIMAX_MODEL=MiniMax-M3`, API endpoint, timeout, and secret through Firebase secret management.
- Verify the configured model through the MiniMax Models API during setup/deployment.
- Send only the approved non-PII context allowlist plus deterministic baseline evidence.
- Require structured JSON for proposed adjustment, reasoning, compound effects, concerns, and cited evidence keys.
- Validate schema, integer range, evidence references, response size, and prompt version server-side.
- Clamp adjustment to `0-15`; calculate final score and level on the server.
- Fall back to baseline on timeout, invalid output, quota failure, or unavailable model.
- Cache by input hash/model/prompt version and log parsed audit metadata without hidden reasoning or PII.

**Exit gate:** Tests cover valid, malformed, out-of-range, missing-evidence, timeout, and unavailable responses. No AI failure blocks authority review.

### Phase 5 - Resources and Authority Workflow (17-26 Aug) - Core Complete

**Lead:** Programmer | **Support:** Design Lead, Tester

- Implement all seven versioned prototype resource formulas using the final risk level.
- Add authority override commands with previous value, rationale, reviewer, and timestamp.
- Define and seed `requiredAuthorities` by event type and location.
- Build authority queue assignment, search, filters, sorting, pagination, and real-time updates.
- Build review detail with final score first and expandable baseline, adjustment, evidence, files, history, and resources.
- Implement callable/HTTP server commands for claim/open, approve, reject, and request amendment.
- Enforce one current decision per authority per application version in a transaction.
- Recompute aggregate status: any rejection wins; amendment blocks; unanimous same-version approval publishes.
- Invalidate prior approvals on resubmission while preserving history.

**Exit gate:** Emulator concurrency tests prove duplicate/conflicting decisions cannot produce an invalid aggregate status, and publication occurs only after every required authority approves the same version.

### Phase 6 - Public Experience and Analytics (27 Aug-2 Sep) - Core Complete

**Lead:** Tester | **Support:** Programmer, Design Lead

- Complete approved-event calendar, filters, event detail, responsive states, and not-found handling.
- Ensure public pages query only sanitized `public_events` records.
- Replace disagreement analytics with baseline-versus-final, adjustment distribution, and AI fallback rate.
- Add applications/approvals by month, risk distribution, risky event types/venues, resources, and turnaround time.
- Add date range filters and CSV export with sanitized fields.
- Use indexed/aggregated queries; avoid unbounded collection scans.

**Exit gate:** At least three required charts and CSV export work from seeded records; public users cannot infer or retrieve private fields.

### Phase 7 - Security, Reliability, and Accessibility (3-9 Sep) - Security Core Complete

**Lead:** Tester | **Support:** Programmer, Project Manager

- Rewrite Firestore and Storage rules for immutable versions, assigned authority access, and server-only collections.
- Add emulator rule tests for organizer, assigned authority, unassigned authority, unauthenticated user, and malicious writes.
- Validate file names, MIME type, size, ownership, and deletion policy.
- Add rate limits, structured logs, correlation IDs, safe errors, retry limits, and budget alerts.
- Define retention for applications, documents, AI records, and audit logs.
- Audit keyboard navigation, focus, labels, contrast, touch targets, overflow, and 390px layouts.
- Verify Chrome, Edge, Safari, desktop, and mobile workflows.

**Exit gate:** All access-denial tests pass; no secrets or PII enter client bundles, logs, AI requests, analytics, or public records; critical workflows meet WCAG-oriented checks.

### Phase 8 - End-to-End UAT and Release Candidate (10-13 Sep) - In Progress

**Lead:** Tester | **Support:** Entire team

- Seed 20-30 Malaysian venues, incidents, accounts, event types, and decision scenarios.
- Automate the golden path and major failures with Playwright against emulators/staging.
- Test AI unavailable, weather stale, duplicate trigger, amendment, rejection, withdrawal, and concurrent approvals.
- Verify every PRD acceptance criterion and record evidence in a UAT checklist.
- Perform data reset/reseed rehearsal and backup/export rehearsal.
- Fix P0/P1 issues; triage P2/P3 issues into release or documented limitations.
- Tag a release candidate and freeze scope.

**Exit gate:** Zero open P0/P1 defects, all MVP acceptance criteria pass, and the team signs off on the same release candidate.

### Phase 9 - Deployment, Demo, and Handover (14-17 Sep)

**Lead:** Project Manager | **Support:** Entire team

- Deploy rules, indexes, Functions, Storage rules, and Hosting to staging, then production.
- Run post-deployment smoke tests with organizer, authority, and public accounts.
- Configure domain/hosting settings, monitoring, budget alerts, and secret rotation ownership.
- Prepare a deterministic demo script and a baseline-only backup scenario.
- Finalize README, architecture diagram, API/configuration guide, test report, known limitations, and contribution guide.
- Record screenshots/video evidence and rehearse the five-person presentation.
- Tag `v1.0.0` and archive final seed data, prompts, rule versions, and submitted documentation.

**Exit gate:** Production golden path passes, rollback steps are documented, demo assets are ready, and the final package is submitted before 17 September 2026 11:59 PM.

## 6. Test Strategy

| Layer | Tool | Required Coverage |
|---|---|---|
| Shared/domain | Vitest | score boundaries, state transitions, schema validation, resource formulas |
| React | Vitest + Testing Library | forms, validation, permissions, loading/error/empty states |
| Functions | Vitest + Emulator Suite | idempotency, fallback, transactions, publication, audit writes |
| Security | Firebase rules unit tests | role/ownership matrix and hostile writes |
| End to end | Playwright | organizer, authority, amendment, rejection, approval, public flows |
| Manual | Browser/accessibility checks | responsive layout, keyboard, Safari/Edge, demo readiness |

Every bug fix includes a regression test when the behavior can be automated.

## 7. Definition of Done

A task is done when:

1. Behavior matches PRD v2.1 and shared contracts.
2. Loading, empty, error, permission, retry, and mobile states are handled.
3. Relevant tests pass locally and in CI.
4. Security rules and audit impact have been reviewed.
5. No PII is added to AI, public records, analytics, or unsafe logs.
6. Documentation and seed data are updated with the same change.
7. A reviewer other than the author accepts the PR.

## 8. Release Gates and Scope Control

**MVP blockers:** authentication, immutable versions, baseline scoring, M3 validated adjustment/fallback, resources, multi-authority decisions, audit logs, public sanitization, required analytics, rule tests, and deployment.

**Cut first if schedule slips:** FCM, PDF export, Google Places assistance, advanced chart drill-down, decorative animation, and non-essential dashboard widgets.

**Do not cut:** deterministic fallback, server-side decisions, security-rule tests, version history, auditability, or public/private separation.

## 9. Immediate Next Sprint

The next sprint executes Phase 8 release-candidate UAT:

1. Seed 20-30 Malaysian venues plus approval, amendment, rejection, fallback, and concurrency scenarios.
2. Automate organizer-to-public golden paths against emulators and staging with Playwright.
3. Verify all PRD acceptance criteria, including Edge and Safari keyboard operation.
4. Rehearse reset, export, backup, and release-candidate deployment procedures.
2. Add advanced analytics for high-risk venues/types, resources, and authority turnaround.
3. Add full Playwright coverage for organizer amendment and rejection paths.
4. Complete Edge and Safari accessibility/browser verification.
5. Define production aggregation and retention strategy before dataset growth.
