# M3 — Gap Analysis vs. FR v4 + Use Case Diagram

**Date:** 2026-08-21 (deployment-readiness update)
**For:** M3 teammate (Chia Yu Xin)

> **Implementation update — 2026-08-21:** The baseline matrix below predates the
> current implementation round. The following gaps are now wired end-to-end:
> initial/manual review (UC-01..05), attachable officer feedback (UC-40),
> explicit hazard-score/resource review records (UC-17 / FR-M3-14), admin
> publish plus sanitised public Stage 2 projections (UC-14..15), public
> confirm/report (UC-35..38), M4 outcome application (UC-30..32), and
> withdrawal cleanup (FR-M3-01). A MiniMax-backed, schema-validated control-list
> proposer with an explicit deterministic fallback is now implemented in M3;
> the fallback is selected only when the secret/provider is unavailable or the
> response fails validation. Firestore/Storage rules are tightened to named
> officer/public-report scopes, and `migrate:m3` backfills legacy denormalised
> fields and public projections before release.

> **Deployment-readiness update — 2026-08-21:** Local source and tests now
> include the full M3 release path, but the currently deployed
> `linkos-496505.web.app` bundle/functions are older than this branch. A live
> Playwright smoke run against that site produced 5/14 passes and exposed the
> old callable/UI contract; it was intentionally not used for mutation after
> this safety round. The repository now provides a staging-only release
> workflow (`.github/workflows/release-staging.yml`), an explicit deployment
> function verifier, a dry-run/apply migration, and environment guards that
> refuse production resets. A real staging Firebase project, CI workload
> identity secrets, seeded UAT accounts, Java 21 for rules tests, and a
> configured MiniMax secret are still required before a deployed UAT can pass.
**Sources cross-referenced:**
- `STERAS_PRD_v5.0.md` §5.3 (M3, 31 FRs)
- `STERAS_M3_FR_v4.md` (31 FRs, locked 2026-08-15, authoritative)
- `STERAS_M3_Modified_Scope_Enhancement_Proposals.md` (the locked workflow + 31 assumptions A1–A30)
- `STERAS_M3_Use_Case_Descriptions_v4.md` (40 UCs, 1-UC-per-bubble)
- `Collaborative - Use Case Diagram.svg` (2026-08-15, "Anny Use case diagram Finalize")
- Current code on `anny_cont` branch (latest: `3799d64`)

The matrix below is retained as a historical baseline from before the current
implementation round. The authoritative current gap is the deployment and
cross-module gate recorded first in this document.

## Current status — authoritative

| Area | Current state | Gap / release action |
|---|---|---|
| M3 FR/UC source implementation | **40/40 UCs implemented in this branch** | No remaining M3 feature is intentionally deferred in source. The M2 manual-review signal and M4 report outcome write remain external contracts that must be exercised in staging. |
| M3 callable surface | **18 required M3 functions exported** | Deploy Functions to staging, run `scripts/verifyM3Deployment.mjs`, then promote only after smoke/full Playwright pass. |
| MiniMax control-list proposal | **Schema-validated MiniMax + explicit deterministic fallback** | Set the staging Secret Manager value and run with `STERAS_REQUIRE_MINIMAX=true`; a fallback-only run is not a production promotion gate. |
| Legacy data shape | **Migration script implemented** | Run `migrate:m3 --dry-run`, review anomalies, then `--apply` in staging; production apply requires `M3_MIGRATION_ALLOW_PRODUCTION=true`. |
| Firestore/Storage access boundaries | **Rules tightened to named officers, owners, reporters, and public projections** | Execute emulator rules tests on Java 21; inspect any legacy event without `assignedOfficerUids` before relying on officer reads/uploads. |
| Current deployed site (`linkos-496505`) | **Stale relative to this branch** | The observed live bundle/functions predate the current M3 callable/UI contract. Do not reset or use it for UAT; deploy to a separate staging project instead. |
| Deployed UAT | **Not yet completed for this branch** | Requires staging project ID, CI Workload Identity secrets, seeded UAT accounts/password, Firebase web config, Java 21 runner, and real MiniMax secret. |

### Remaining gaps before Module 3 is fully verified in a deployed environment

1. Provision and seed an isolated Firebase staging project; configure the
   `staging` GitHub environment and the variables documented in
   `frontend/.env.e2e.example`.
2. Deploy Functions first, verify all required IDs, run the migration dry-run
   and apply, then deploy Firestore/Storage rules and Hosting.
3. Run M3 smoke, full, and officer-workstream Playwright suites against that
   staging URL. The previous live run against the legacy site was 5/14 passes
   and is evidence of deployment drift, not a valid current-branch result.
4. Confirm M2 emits the agreed `Manual Review Required` state when its AI path
   is unavailable and confirm M4 updates `public_reports/{ticketId}` with
   `outcome`, `outcomeSetBy`, and `outcomeSetAt`; these are integration checks,
   not missing M3 code.
5. Run the complete release gate (`npm run check`, `npm run test:rules`, and
   the staging Playwright suites) on Java 21/Node 22, then retain migration and
   Playwright artifacts for promotion approval.

---

## Appendix A — historical baseline (pre-deployment-readiness round)

| Status | Count | % of 40 UCs |
|---|---:|---:|
| ✅ Implemented | 25 | 62% |
| ⚠️ Partially implemented | 3 | 7% |
| ❌ Not implemented | 12 | 30% |

**Current state** (after Q1 refactor + Workstream 1 + Workstream 1 polish + Workstream 2 + Workstream 3, on `anny_cont`):

- **Workstream 1 shipped** (`44a7840`): officer assignment, multi-stage review, second review aggregator. Cleared UC-06..12, UC-20, UC-39 (13 UCs).
- **Q1 refactor shipped** (`ab8b33d`): per-doc Stage 1 verification. Cleared UC-22..25 (4 UCs).
- **Workstream 1 polish shipped** (`7bd47f1`): unassign swap, audit log, FR-M3-16 checkbox, FR-M3-08 reason/suggestion split, queue link. Lifted UC-20 from ⚠️ to ✅ and UC-27 from ⚠️ to ✅.
- **Workstream 2 shipped** (`af9805f`): event control list model + admin-driven AI generation. Cleared UC-13, UC-33, UC-34. The flow is admin-initiated (no `onEventApproved` trigger) — the M3 owner decided on 2026-08-18 that the admin must click "Generate proposal" then "Commit changes". M3 ships a stub `proposeControlItemsForEvent` helper that returns one item per required authority; the M2 owner will replace it with the real AI-backed version.
- **Workstream 3 shipped** (`ddf22d7`): organizer Stage 1 upload + "Use Previous" (UC-28, UC-29). `OrganizerEventControls` converted from read-only to editable. `submitStage1Doc` Cloud Function takes either an upload (base64 in Firestore, 700 KB cap) or a `usePrevious: true` flag (A25 receipt-only, no source-event picker per M3 owner decision 2026-08-19).
- **Initial review stage** (FR-M3-02, FR-M3-03/04) is the only remaining piece of the "review and decide" lane. Deferred to its own round (UC-03, UC-04 still ⚠️).
- **Stage 2 + public verification** (Workstream 4) is the next big chunk. 11 UCs remaining: UC-01, 02, 05, 30, 31, 32, 35, 36, 37, 38, 40 (12 if you count the still-partial UC-17, which is a small UI-only fix).

---

## 2. UC-by-UC map (40 UCs)

Legend: ✅ implemented · ⚠️ partial · ❌ missing

### A. Admin (15 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-01 | Require Manual Review | FR-M3-03 | ❌ | No `manual_review_in_progress` status; no admin trigger to take over. |
| UC-02 | Complete and Record Manual Assessment | FR-M3-04 | ❌ | No manual-assessment form. Assessment is auto-generated by `onEventCreated`; no admin hand-written input. |
| UC-03 | Initial Review | FR-M3-02 | ⚠️ | **Deferred.** Admin *can* view via `AdminApplicationReview.tsx` but there is no separate "initial review" stage distinct from "officer review". The new flow uses `reviewStage: 'authority' | 'second'` — needs `'initial'` (FR-M3-02). |
| UC-04 | Approve for Authority Review | FR-M3-07 | ⚠️ | **Deferred.** Admin can approve, but the model is `Pending → UnderReview → Approved`, not `Pending → UnderReview (initial) → Authority Review → Second Review → Approved`. |
| UC-05 | Reject at Initial Review | FR-M3-05, -07 | ❌ | **Deferred.** Reject path exists at the *officer* level (UC-21) but no distinct "initial review reject with reason + suggestion" admin flow. |
| UC-06 | Assign Authority Officers | FR-M3-12 | ✅ | **`assignAuthorityOfficers` Cloud Function** (`44a7840`) + `AdminAssignment` page + `/admin/applications/:id/assign` route. |
| UC-07 | Modify Officer Selection | FR-M3-11 | ✅ | Admin can swap officers in `AdminAssignment` before any officer has recorded a proposal. Plus `unassignAuthorityOfficers` (`7bd47f1`) for A15 backup officer swap. |
| UC-08 | Display Officer Checklist | FR-M3-09 | ✅ | `AdminAssignment` shows the full checklist per required authority, with workload + state scope. |
| UC-09 | Default-Check by Venue State | FR-M3-10, A2–A4 | ✅ | `assignAuthorityOfficers` default-checks the lowest-workload eligible officer (state-scope match per A4). |
| UC-10 | Second Review | FR-M3-17 | ✅ | **`makeSecondReviewDecision` Cloud Function** (`44a7840`) — pure aggregator (A7: refuses to override). Auto-advances `event.reviewStage = 'second'` when all officers complete. |
| UC-11 | Reject at Second Review | FR-M3-05, -07 | ✅ | Same function. Featured officer's `reason` + `suggestion` are surfaced in the organiser notification. |
| UC-12 | Grant Final Approval | FR-M3-07 | ✅ | Same function. `event.status` only updates after the second review confirms. |
| UC-13 | Edit Event Control List | FR-M3-19 | ✅ | **`editEventControlList` Cloud Function** + `AdminControlListEditor.tsx` (`af9805f`). Admin clicks "Generate proposal" → edits items inline (rename control, add/remove Stage 1 requirements, add/remove control items) → "Commit changes". Commit wipes existing `event_controls/*` + per-control `stage1_docs/*`, writes one `event_controls/{controlId}` doc per item, sets `event.controlListGenerated = true` + writes the snapshot, and writes a `control_list_published` audit log entry (controlItemVersion=1, controlIds=[…]). Does NOT pre-seed `stage1_docs` (that's Workstream 3 — organizer upload). |
| UC-14 | Publish Event Control Document to Public View | FR-M3-21 | ❌ | Workstream 5. |
| UC-15 | Sanitise Event Control Document | FR-M3-21 | ❌ | Workstream 5. |

### B. Officer (10 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-16 | Review Assigned Application | FR-M3-13, -14 | ✅ | `AuthorityEventReview.tsx` — assigned authority loads the event. |
| UC-17 | Confirm Resource Recommendation | FR-M3-14 | ⚠️ | Resource panel is visible, but the "confirm" action is implicit (the override form is the only way to interact). No explicit "I confirm" button. |
| UC-18 | Override Resource Recommendation | FR-M3-24 | ✅ | "Adjust" button + override form. |
| UC-19 | Record Override Details and Reason | FR-M3-24 | ✅ | `overrideResources` Cloud Function persists original/revised/UID/authority/timestamp + audit. |
| UC-20 | Approve Assigned Application | FR-M3-16 | ✅ | **`recordOfficerProposal` + `AuthorityEventReview.tsx` checkbox**. Approve requires `confirmedReview: true` (UI checkbox). |
| UC-21 | Reject Assigned Application | FR-M3-15 | ✅ | Reject button + `recordOfficerProposal` (separated `reason` + `suggestion` fields per FR-M3-05). |
| UC-22 | Review Stage 1 Event Control Document | FR-M3-22 | ✅ | **Q1 refactor** (`ab8b33d`): `event_controls/{controlId}/stage1_docs/{docId}` is the per-doc sub-collection. `AuthorityEventReview.tsx` renders per-doc cards with status badges and provenance. |
| UC-23 | Verify Stage 1 Documentation | FR-M3-22 | ✅ | **`verifyStage1Doc` Cloud Function** (`ab8b33d`). Officer verifies a single Stage 1 doc (application, licence, insurance, …); the parent control's aggregate `label` is recomputed by the function. |
| UC-24 | Reject Stage 1 Document | FR-M3-23 | ✅ | Same function, `status: 'rejected'`. Per-doc rejection persists; aggregate flips to `resubmit_required` if any doc is rejected. |
| UC-25 | Require Resubmission Stage 1 | FR-M3-23 | ✅ | Same — aggregate label `resubmit_required` triggers the resubmission flow. |

### C. Organizer (4 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-26 | Receive Result of Event Application | FR-M3-08 | ✅ | `notifications/{id}` written by `createNotification` post-decision. NotificationBell surfaces it. |
| UC-27 | View Application Result and Feedback | FR-M3-08 | ✅ | **FR-M3-08 split fields** (`7bd47f1`). `Notification` interface carries `reason?` + `suggestion?` as separate fields. `makeSecondReviewDecision` passes the featured officer's `reason` + `suggestion` verbatim. `NotificationBell.tsx` renders them on separate lines under the `message`. |
| UC-28 | Upload Event Control Document | FR-M3-20, -25 | ✅ | **`submitStage1Doc` Cloud Function** + `Stage1RequirementRow.tsx` + `OrganizerEventControls` editable view (`ddf22d7`). Organizer picks a file (JPEG / PNG / PDF, <= 700 KB binary — ~940 KB base64, under the 1 MB Firestore doc limit). The function writes the doc with `status: 'pending_verification'` + a data: URL `filePath` (per project convention, NOT Firebase Storage). Per-doc `usePrevious: true` path also shipped (see UC-29). Notifies the assigned officer + admin; writes a `stage1_doc_submitted` audit log entry. Refuses if the existing doc is `status: 'verified'` (organizer cannot re-upload after an officer approved without admin involvement). |
| UC-29 | Reuse Previous Event Item | FR-M3-26 | ✅ | **One-click "Use Previous" button** on `docType: 'receipt'` slots only (A25). M3 owner decision 2026-08-19: NO source-event picker — the organizer just marks the slot as `use_previous`, and Stage 2 is the public verification backstop (per the dropped-A26 decision from 2026-08-17). The function refuses `usePrevious` on non-receipt slots with a clear error. Audit `notes` records the rationale ("Use Previous: organizer asserted item already procured; Stage 2 is the verification backstop."). |

### D. M4 Outcome (3 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-30 | Receive Event Control Incident Outcome | FR-M3-30, -31 | ❌ | No M4 trigger. No `public_reports/{ticketId}.update` listener. M4 module itself doesn't exist yet. |
| UC-31 | Require Resubmission M4 Outcome | FR-M3-30 | ❌ | Same. |
| UC-32 | Restore Documentation to Approved | FR-M3-31 | ❌ | Same. |

### E. System (2 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-33 | Generate Proposed Event Control List | FR-M3-18 | ✅ | **`generateEventControlList` Cloud Function** + `proposeControlItemsForEvent` helper (`af9805f`). Admin-initiated: admin calls `generateEventControlList({eventId})`, which delegates to `proposeControlItemsForEvent` and returns `{items, cached, source: 'proposeEventControlList'}`. The first call re-runs the propose logic; subsequent calls (when `event.controlListGenerated === true`) return the persisted snapshot with `cached: true / source: 'cache'` (A23 — don't regenerate without explicit reason). Pass `force: true` to skip the cache. **M3 ships a stub** that returns one item per required authority (PDRM, BOMBA, KKM, DBKL, MOTAC) with reasonable per-authority Stage 1 + Stage 2 templates. The M2 owner replaces the stub with the real AI-backed version (FR-M3-18's "send to MiniMax"). |
| UC-34 | Display Stage 1 and Stage 2 Requirements | FR-M3-25 | ✅ | **`OrganizerEventControls.tsx`** read-only view at `/organizer/events/:id/controls` (`af9805f`). Empty state ("admin hasn't published the control list yet") when `!event.controlListGenerated`. Once the admin has committed, one card per required authority with the control name, authority badge, "Stage 1 documents required: N" count, and "Stage 2 (visual evidence): <label>" line. Header badge toggles to "List published" on commit. |

### F. Public Viewer (4 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-35 | Verify Stage 2 Event Control Document | FR-M3-27 | ❌ | No "👍 Confirm" button anywhere. `PublicEventDetail.tsx` shows the approved event but not its controls. |
| UC-36 | Report Stage 2 Document | FR-M3-29 | ❌ | No "🚩 Report" button. |
| UC-37 | Increase and Display Confirmation Count | FR-M3-28 | ❌ | No confirmation count UI. (Mock data has `publicConfirmCount` but no real increment path or public display.) |
| UC-38 | Direct Report to Incident Reporting Module | FR-M3-29 | ❌ | No M4 integration; M4 doesn't exist. |

### G. Cross-cutting (2 UCs)

| UC | Title | FR | Status | Where / why |
|---|---|---|---|---|
| UC-39 | Record Rejection Reason and Suggestion | FR-M3-05 | ✅ | **`recordOfficerProposal` and `makeSecondReviewDecision`** require structured rejection reason + suggestion. They are surfaced in the `application_rejected` notification. |
| UC-40 | Attach Authority Officer Feedback | FR-M3-06 | ❌ | When admin rejects at initial review, the officer's per-authority feedback isn't attached. (Officer decisions *are* written to `decisions/{authType}`, but they're not surfaced as feedback the admin attaches to the rejection.) |

---

## 3. Gap clusters (where to spend the next rounds)

I recommend grouping the 28 missing + 6 partial UCs into **6 workstreams**. Order them by dependency.

### Workstream 1 — Officer assignment + multi-stage review (UC-03..12, UC-39, UC-40)
**Status: SHIPPED** on `anny_cont` (`44a7840` + `7bd47f1`). Cleared UC-06..12, UC-39, UC-40. The 5 polish items (unassign swap, audit log, FR-M3-16 checkbox, FR-M3-08 split, queue link) shipped in `7bd47f1` — see the polish commit for details.

**Remaining pieces** (deferred to their own round):
- `UC-03/04/05` (initial review stage + initial-review reject). The current flow is `Pending → UnderReview → reviewStage:'authority' → reviewStage:'second' → Approved` (via the new officer flow). Adding a distinct "initial review" stage would need a new `reviewStage: 'initial'` and a `makeInitialReviewDecision` Cloud Function. The plan for this lives in `docs/team-handoffs/M3_WORKSTREAM1_POLISH_PLAN.md` §1 (where I deferred it as its own workstream).
- `UC-40` (admin explicitly attaches officer feedback). In the current flow, the featured officer's `reason` + `suggestion` *are* attached to the notification (FR-M3-08 split), so the gap is more "no dedicated admin UI to compose a rejection using officer feedback" than "officer feedback is missing". Lower priority.

**What I built (in summary):**
- `OfficerProfile` type with `state`, `scopeType`, `workloadCount`, `workloadLimit`, `active`. 5 officers seeded (PDRM/BOMBA/KKM/DBKL/MOTAC, all state='Selangor').
- `Assignment` type + `events/{id}/assignments/{versionId}_{auth}` sub-collection.
- `assignAuthorityOfficers` Cloud Function (admin, `dryRun` + `commit` modes, transaction-safe, default-checks by lowest workloadCount + state-scope matching per A4). Writes one `assignment_created` audit log per officer in the same transaction.
- `recordOfficerProposal` Cloud Function (officer, requires assignment, auto-advances `reviewStage = 'second'` when all officers complete). Reason + suggestion split. `confirmedReview: true` required for Approve (FR-M3-16).
- `makeSecondReviewDecision` Cloud Function (admin, pure aggregator per A7 — refuses overrides). Decrements workload, writes featured officer's `reason` + `suggestion` as separate notification fields.
- `unassignAuthorityOfficers` Cloud Function (admin, A15 backup officer swap, refuses if any officer has recorded a proposal).
- `AdminAssignment` page at `/admin/applications/:id/assign` (radio-button checklist, swap officers, Confirm aggregate card, per-row Unassign buttons).
- Per-row "Assign" link in `AdminApplicationQueue` (hidden when past the assignment stage).
- `confirmedReview` checkbox in `AuthorityEventReview` "Your decision" section (only required for Approve).

### Workstream 2 — Event control list model + AI generation (UC-13, UC-33, UC-34)
**Status: SHIPPED** on `anny_cont` (`af9805f`).

- New `EventRecord.controlListGenerated?: boolean` + `EventRecord.controlListSnapshot?: Array<{controlId, authority, controlName, stage1RequirementsCount, controlItemVersion, label}>` fields. New `AuditAction: 'control_list_published'` + `NotificationType: 'control_list_published'`.
- `generateEventControlList(eventId, {force?})` (admin): calls `proposeControlItemsForEvent` and returns `{items, cached, source}`. Cached on re-call (A23) when `event.controlListGenerated === true` — reads from `event.controlListSnapshot` and returns `cached: true / source: 'cache'`. `force: true` to skip cache. **The M3 owner decided on 2026-08-18 that the admin must click "Generate proposal"** — there's no Firestore trigger on `events/{id}.update` auto-running the generation. Rationale: keeps the AI call auditable and lets the admin edit before any control is committed.
- `editEventControlList(eventId, items)` (admin, commit point): wipes existing `event_controls/*` and per-control `stage1_docs/*`, writes one `event_controls/{controlId}` doc per item, sets `event.controlListGenerated = true` + writes the snapshot, writes a `control_list_published` audit log entry (controlItemVersion=1, controlIds=[…]). Does NOT pre-seed `stage1_docs` — that's Workstream 3 (organizer upload).
- `proposeEventControlList` was refactored to extract `proposeControlItemsForEvent` for reuse — so `generateEventControlList` can call it without going through the onCall surface. The M3 stub returns one item per required authority with a sensible per-authority template (PDRM/BOMBA/KKM/DBKL/MOTAC). The M2 owner will replace the stub with the real AI-backed version.
- `AdminControlListEditor` page at `/admin/applications/:id/controls`: table with inline edit (rename control / Stage 1 doc), per-row Add / Remove buttons, "Generate proposal" + "Commit changes" buttons. Shows `cached: true / source: 'cache'` badge when re-opening after commit.
- `OrganizerEventControls` page at `/organizer/events/:id/controls`: read-only view (UC-34). Empty state ("admin hasn't published the control list yet") when `!event.controlListGenerated`. One card per required authority once committed.
- `AdminApplicationReview` now has an "Open event control list" link to the editor.

**UCs cleared:** UC-13, UC-33, UC-34.

### Workstream 3 — Stage 1: organizer upload + officer verify (UC-22..25, UC-28, UC-29)
**Why third:** depends on the control list (workstream 2) and on the review flow (workstream 1).

- New collection / sub-collection: `events/{id}/event_controls/{controlId}/stage1_docs/{docId}`.
- New organizer page: `OrganizerEventControls` (per-event). Lists all controls with their Stage 1 + Stage 2 requirements. Each Stage 1 slot is a file upload (or "Use Previous" — UC-29).
- Extend `verifyEventControl` to operate on `stage1_docs/{docId}` instead of the control itself. Or add a sibling `verifyStage1Doc(eventId, controlId, docId, status, rationale, evidencePath)`.
- "Use Previous" (UC-29, FR-M3-26, A25): only for `docType: 'receipt'`. Audit log: "Reused from event X". No upload, no verification. **Per M3 owner decision (2026-08-17), A26's "only when system has prior event data" gate is dropped** — organizer can click "Use Previous" on any receipt slot. Stage 2 image remains mandatory and is the public-verification backstop.

**UCs cleared:** UC-22, UC-23, UC-24, UC-25, UC-28, UC-29.

### Workstream 4 — Stage 2: organizer upload + public confirm/report (UC-35..38)
**Why fourth:** Stage 2 can only be uploaded after Stage 1 verifies. Depends on workstream 3.

- Extend `EventControl.stage2Docs` (already in the mock shape).
- Stage 2 image upload in the organizer's `EventControls` page.
- `PublicEventDetail` extension: render the control list, with 👍 Confirm and 🚩 Report buttons. Confirmation count visible. Rate limit: 1 report per user per control (A30).
- New Cloud Functions:
  - `confirmStage2Doc({eventId, controlId, docId})` — server-side check rate limit, increment `publicConfirmCount`.
  - `reportStage2Doc({eventId, controlId, docId, category, description})` — server-side rate limit, write to M4 (or to a holding collection M4 picks up — A27: "M3 receives a `notificationRequest` from M4"; FR-M3-29: "direct to the incident report module").

**UCs cleared:** UC-35, UC-36, UC-37, UC-38.

### Workstream 5 — Admin publish (UC-14, UC-15)
**Why fifth:** can only happen after Stage 1 verifies + (optionally) Stage 2 confirms.

- New admin page: `AdminPublishControls` (per-event). Shows the verified Stage 1 docs + the Stage 2 images. Admin ticks which to publish. Sanitisation function strips PII (receipts, organiser phone) from Stage 1 before going public (A18: "status-only; no document downloads" — so sanitisation = strip downloadable artifacts; we publish metadata + a status badge).
- New Cloud Function: `publishControlDocument({eventId, controlId, stage, docId})`. Writes to `public_event_controls/{eventId}/{controlId}` (new collection; needs rules).

**UCs cleared:** UC-14, UC-15.

### Workstream 6 — M4 outcome trigger (UC-30, UC-31, UC-32)
**Why last:** depends on M4 actually existing. Per A27 + R8.5#1: a Firestore trigger on `public_reports/{ticketId}.update`. When M4 writes the outcome, M3 auto-updates the reported control item's status (FR-M3-30 → `Resubmit Required`; FR-M3-31 → restore to `Approved`). M3 also notifies the admin (R8.5#6).

**UCs cleared:** UC-30, UC-31, UC-32.

### Cross-cutting — Notification + Withdrawn cleanup
- `FR-M3-08` (reason + suggestion on rejection notifications) — **SHIPPED** (`7bd47f1`). `Notification` interface carries `reason?: string` + `suggestion?: string`. `makeSecondReviewDecision` passes the featured officer's `reason` + `suggestion` verbatim. `NotificationBell.tsx` renders them on separate lines.
- `FR-M3-01` (Withdrawn → close pending reviews, unpublish controls, retain records). The current M1 withdrawal sets `status: Withdrawn`; M3 has no listener. Add a Cloud Function trigger on `events/{id}.update` that, when status moves to `Withdrawn`, unpublishes any control docs and closes any open officer reviews. (Or move it to `onEventUpdated`.)

---

## 4. FR-by-FR pass

For traceability against the 31 FRs:

| FR | Title | UC | Status |
|---|---|---|---|
| FR-M3-01 | Close pending reviews on Withdrawn | — | ❌ |
| FR-M3-02 | Initial review | UC-03 | ⚠️ (deferred to its own round) |
| FR-M3-03 | Initial review for Manual Review Required | UC-01 | ❌ (deferred) |
| FR-M3-04 | Complete manual assessment | UC-02 | ❌ (deferred) |
| FR-M3-05 | Reason + suggestion on reject | UC-39 | ✅ (`recordOfficerProposal` requires both; featured officer's reason+suggestion surface in the notification) |
| FR-M3-06 | Attach officer feedback on reject | UC-40 | ❌ (deferred — admin doesn't yet explicitly attach officer feedback in the new flow) |
| FR-M3-07 | Approve / reject at initial + second review | UC-04, -11, -12 | ⚠️ (UC-04 deferred; UC-11, UC-12 ✅ via `makeSecondReviewDecision`) |
| FR-M3-08 | Notify organiser on rejection | UC-26, -27 | ✅ (`reason` + `suggestion` are now separate fields on the Notification; bell renders them on separate lines) |
| FR-M3-09 | List officers in checklist | UC-08 | ✅ (Workstream 1) |
| FR-M3-10 | Default-check by state | UC-09 | ✅ (Workstream 1 — workload + state-scope matching) |
| FR-M3-11 | Admin can modify checklist | UC-07 | ✅ (Workstream 1 — swap officers in `AdminAssignment`) |
| FR-M3-12 | Assign officers | UC-06 | ✅ (Workstream 1 — `assignAuthorityOfficers`) |
| FR-M3-13 | Display only assigned events | UC-16 | ✅ (via Firestore rules) |
| FR-M3-14 | Officer review + override scores | UC-16, -17 | ✅ (review), ⚠️ (override scores still not implemented — minor) |
| FR-M3-15 | Officer reject (reason + suggestion) | UC-21 | ✅ (separate `reason` + `suggestion` fields) |
| FR-M3-16 | Officer approve (checkbox confirmation) | UC-20 | ✅ (checkbox in `AuthorityEventReview`; `confirmedReview: true` required in Cloud Function) |
| FR-M3-17 | Admin second review | UC-10 | ✅ (`makeSecondReviewDecision` — pure aggregator) |
| FR-M3-18 | AI proposes event control list | UC-33 | ✅ (Workstream 2 — `generateEventControlList` + stub `proposeControlItemsForEvent`; M2 owner replaces the stub with the real AI) |
| FR-M3-19 | Admin modify control list | UC-13 | ✅ (Workstream 2 — `editEventControlList` + `AdminControlListEditor`) |
| FR-M3-20 | Organiser upload documentation | UC-28 | ✅ (Workstream 3 — `submitStage1Doc` + `Stage1RequirementRow`) |
| FR-M3-21 | Admin publish to public | UC-14, -15 | ❌ (Workstream 5) |
| FR-M3-22 | Officer verify Stage 1 | UC-22, -23 | ✅ (Q1 refactor + per-doc UI) |
| FR-M3-23 | Officer reject Stage 1 | UC-24, -25 | ✅ (Q1 refactor) |
| FR-M3-24 | Resource override (full audit) | UC-18, -19 | ✅ |
| FR-M3-25 | Stage 1 + Stage 2 listed together | UC-34 | ✅ (Workstream 2 read-only view; Workstream 3 made Stage 1 editable; Stage 2 upload still in Workstream 4) |
| FR-M3-26 | "Use Previous" | UC-29 | ✅ (Workstream 3 — one-click flag, A25 receipt-only, A26 gate dropped per M3 owner decisions 2026-08-17 + 2026-08-19) |
| FR-M3-27 | Public confirm Stage 2 | UC-35 | ❌ (Workstream 4) |
| FR-M3-28 | Public confirmation count | UC-37 | ❌ (Workstream 4) |
| FR-M3-29 | Public report → M4 | UC-36, -38 | ❌ (Workstream 4 + 6) |
| FR-M3-30 | Resubmit on confirmed-true report | UC-31 | ❌ (Workstream 6) |
| FR-M3-31 | Restore on dismissed report | UC-32 | ❌ (Workstream 6) |

**Counts (after Workstream 1 + Q1 + polish + Workstream 2 + Workstream 3, on `anny_cont`):**

| FR | Status |
|---|---|
| ✅ Fully implemented | FR-M3-05, -08, -09, -10, -11, -12, -13, -15, -16, -17, -18, -19, -20, -22, -23, -24, -25, -26 = **18** |
| ⚠️ Partial | FR-M3-02, -07, -14 = **3** (FR-M3-02 + the second half of FR-M3-07 are deferred to the initial-review round; FR-M3-14 is missing the "override scores" half) |
| ❌ Not implemented | FR-M3-01, -03, -04, -06, -21, -27, -28, -29, -30, -31 = **10** |

(FYI: the `compliance` + `readiness` gates I added count as implementation of FR-M2-03 / FR-M2-08 enforcement, but those are M2's FRs not M3's. They land in M3's "decision" code path.)

---

## 5. What I built (the `anny_cont` round) — restated against UCs

So the conversation we're having makes sense, here's what the `anny_cont` rounds actually delivered against the UC map:

| Commit | What it added | UCs it lifts to ✅ (or partially to ⚠️) |
|---|---|---|
| `5437814` + `a9a6f98` | `makeAuthorityDecision` compliance + readiness gates; `listMyNotifications` / `markNotificationRead`; NotificationBell UI; Stage 1 control verification UI (legacy `verifyEventControl`); Firestore rules + index | UC-23 (partial), UC-26 ✅, UC-27 (partial) |
| `44a7840` + `2b8db0d` | Workstream 1: `assignAuthorityOfficers` + `recordOfficerProposal` + `makeSecondReviewDecision`; `AdminAssignment` page; per-row "Assign" link from queue; `OfficerProfile` + `Assignment` types | UC-06, UC-07, UC-08, UC-09, UC-10, UC-11, UC-12, UC-39, UC-20 (all ✅) |
| `ab8b33d` | Q1 refactor: `verifyStage1Doc` per-doc sub-collection; per-doc UI in `AuthorityEventReview`; `Stage1Doc` type | UC-22, UC-23, UC-24, UC-25 (all ✅ — flipped from ❌/⚠️) |
| `7bd47f1` + `683a108` | Workstream 1 polish: `unassignAuthorityOfficers`; audit log for assignment actions; FR-M3-16 checkbox; FR-M3-08 reason/suggestion split; per-row "Assign" link; `unassign-officer.spec.ts` (3 specs) | UC-20 (✅, was ⚠️), UC-27 (✅, was ⚠️); plus UC-07 gets a "swap" affordance via the new unassign function. |
| `af9805f` + `630dfa7` | **Workstream 2**: `generateEventControlList` (admin, cached on re-call, `force: true` to skip cache); `editEventControlList` (admin, commit point — wipes + writes `event_controls/*`, sets `controlListGenerated`, writes `control_list_published` audit log); `proposeControlItemsForEvent` helper extracted from `proposeEventControlList`; `AdminControlListEditor` (table with inline edit, Add/Remove per row, "Generate proposal" + "Commit changes"); `OrganizerEventControls` (read-only view, UC-34); `AdminApplicationReview` "Open event control list" link; new types (`AuditAction: 'control_list_published'`, `NotificationType: 'control_list_published'`, `EventRecord.controlListGenerated?`, `EventRecord.controlListSnapshot?`); 4 new E2E specs (3 generate + 1 organizer) | UC-13, UC-33, UC-34 (all ✅, were ❌) |
| `ddf22d7` + `3799d64` | **Workstream 3**: `submitStage1Doc` (organizer, two paths — upload with 700 KB base64 cap OR one-click `usePrevious` flag for receipts); `aggregateLabel` helper extracted to `utils/controlAggregate.ts`; `Stage1RequirementRow` (per-doc row with 5 status states + 4 button states); `OrganizerEventControls` converted from read-only to editable (subscribes to per-control `stage1_docs/*` via `onSnapshot`); 4 new E2E specs; 1 existing spec updated to match the new editable UI | UC-28, UC-29 (both ✅, were ❌) |

**Net result:** 14 UCs moved to ✅ (WS1), 2 UCs moved from ⚠️ to ✅ (WS1 polish), 4 UCs moved from ❌ to ✅ (Q1 refactor), 3 UCs moved from ❌ to ✅ (WS2), 2 UCs moved from ❌ to ✅ (WS3). Total ✅ count went from 6 → 25 (62% of 40). Total ⚠️: 3 (unchanged — UC-03, UC-04, UC-17).

---

## 6. Open questions for the M3 owner (grill-me)

In the spirit of "grill the plan", here are the decisions that, if you don't make them now, will block the workstreams above. My recommendation is in **bold**.

### Q1: `verifyEventControl` works on `event_controls/{controlId}`. But FR-M3-22 says "verify Stage 1 event control documentation" — which means it should operate on a *doc* inside a control, not the control itself.
- **A**: Rename / extend. New entity: `event_controls/{controlId}/stage1_docs/{docId}`. Move `verifyEventControl` to operate on the doc. The `event_controls/{controlId}` doc just becomes the catalogue; the per-doc verification lives one level down. This is a breaking change to the data model and the Cloud Function I just shipped, but it's the right shape.
- B: Keep `verifyEventControl` on the control, add a separate `verifyStage1Doc` for Stage 1. Two parallel code paths. Simpler migration, more code to maintain.
- C: Reframe — say "control" in the FR really means "control item" in the data model, and "Stage 1 documentation" is a sub-collection under it. Document this in the data model spec and keep my current Cloud Function but route it to the doc-level operation internally.

**My pick: A.** It's the cleanest match to the v4 spec, and the `anny_cont` round is not merged to main yet — you can change the shape now without a migration.

### Q2: The new admin pages (Assignment, ControlListEditor, PublishControls) — are these in M3 scope or do they go to "General integration"?
- A: M3 owns them. The M3 handoff says "M3 owns each full page file above" + lists admin pages including "second review page" and "review/audit page".
- B: General / Admin layout owns them. M3 supplies the data layer and the per-page panels.
- C: M3 owns the data + business logic; the layout is shared with the existing admin shell.

**My pick: C.** The admin shell already exists (`AdminLayout.tsx`, `AdminApplicationReview.tsx`). New pages slot in as `AdminAssignment`, `AdminControlListEditor`, `AdminPublishControls` — same layout, M3 logic.

### Q3: The "Use Previous" gate (A26: only when system has prior event data) — how do you detect "prior event data"?
- A: The organizer's UID has at least one event with a verified Stage 1 receipt of the same `controlId`. Implemented as a query: `events where organizerId == currentUid && event_controls/*/stage1_docs/* verified`.
- B: A simpler rule: any organizer who has any prior event in the system can use "Use Previous". Less strict, easier to implement.
- C: Per control: the control itself exists on a prior event by the same organiser.
- **D (M3 owner decision, 2026-08-17): Drop the gate entirely.** Organizer can click "Use Previous" on any purchase-receipt Stage 1 slot, no conditions. The Stage 2 image remains mandatory and is the public-verification backstop — if the item isn't actually at the venue, the public sees the gap via Stage 2 and can report via M4. This effectively relaxes the locked assumption A26. The "Use Previous" button becomes a UX shortcut (skip the upload), not a verification bypass.

**My pick now: D.** The user's reasoning holds: Stage 2 is the verification surface, not Stage 1. The extra query cost in option A isn't worth the friction.

### Q4: M4 doesn't exist yet. What should M3 do today to make the future trigger plug-in easy?
- A: Define the contract in `shared/types.ts` now — `public_reports/{ticketId}` shape, the `outcome` field values (`'confirmed_true' | 'dismissed_fake' | 'under_review'`). Don't build the trigger; just make the data model ready.
- B: Build a stub trigger in M3 that listens for any `public_reports` doc, no-ops if M4 isn't writing. So the moment M4 lands, it Just Works.
- C: Wait for M4 to land; do nothing now.

**My pick: A.** Lowest cost, no fake code, no half-built trigger. M3 just needs the type + a clear `// TODO: trigger` comment on the relevant collection.

### Q5: Where does the control list get *generated* — M2 or M3?
The FR says "send … to MiniMax M3 to generate a proposed event control list" (FR-M3-18). The FR is *about* M3 but the AI call is the same MiniMax used by M2 for hazard analysis.
- A: Add a new callable `proposeEventControlList` in M2 (it has the hazard model). M3 calls it, persists, lets admin edit.
- B: Add the AI call directly in M3 (`generateEventControlList` in `http/`). M3 owns the AI prompt.
- C: Extract a shared `lib/minimax/` directory; both M2 and M3 call it.

**My pick: A.** Cleanest module split; M2 already has the AI plumbing. The M2 owner can scope it in one PR; M3 just calls.

---

## 7. My recommended attack order

If you want the highest-leverage work in the next round:

1. **Workstream 1 (officer assignment + multi-stage review)** — biggest unlock. Unblocks the rest of the workflow.
2. **Workstream 2 (control list model + AI generation)** — the new entity that everything attaches to.
3. **Workstream 3 (Stage 1)** — the first thing the *organizer* actually does post-approval. Visible to the user.
4. **Workstream 4 (Stage 2 + public verification)** — where the public viewer comes in.
5. **Workstream 5 (admin publish)** — gates public visibility.
6. **Workstream 6 (M4 trigger)** — last, depends on M4.

Each workstream is roughly 1 PR. Workstream 1 is the biggest because it touches the data model + a new admin page + the officer decision Cloud Function.

If you only have time for **one** workstream this round, **Workstream 1** is the one. It changes the meaning of the existing officer UCs and unblocks the second-review path the spec keeps calling for.

---

## 8. Commit / deploy state as of `3799d64`

- `anny_cont` is **not merged to main**. Safe to refactor.
- All Cloud Functions deployed to `asia-southeast1` (verified via `firebase functions:list`). Latest addition: `submitStage1Doc` (Workstream 3).
- **43/43 Playwright specs pass** across 3 projects: m3-smoke (14), m3-full (22), m3-workstream1 (7). 4 new specs since `630dfa7` (the 4 organizer-stage1-upload specs).
- Firestore rules + indexes deployed.
- Frontend hosted at `https://linkos-496505.web.app`. Latest deploy: Workstream 3 (`OrganizerEventControls` editable view, `Stage1RequirementRow`, submit buttons).

If you want to start Workstream 4 (Stage 2 + public verification), the cleanest entry is to add the Stage 2 file-upload to `OrganizerEventControls` (next to the existing "Stage 2 (visual evidence)" placeholder) and a `submitStage2Doc` Cloud Function. Then `PublicEventDetail` extension: 👍 Confirm + 🚩 Report buttons on each verified Stage 2 image. Rate limit per user (A30).
