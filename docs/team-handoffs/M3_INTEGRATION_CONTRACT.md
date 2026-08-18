# M3 — Cross-Module Integration Contract

**Date:** 2026-08-17
**Owner:** M3 teammate (Chia Yu Xin)
**Status:** Locked against decisions in `STERAS_M3_FR_v4.md` + `M3_GAP_ANALYSIS.md` (Q1=A, Q2=C, Q3=D, Q4=A, Q5=A)
**For:** M1, M2, M4, M5 owners — and future-M3

This document is the **handoff contract** for cross-module integration. It tells every other module:

1. What M3 owns.
2. What M3 exposes that you can directly use (callable functions, collections, types).
3. What M3 needs from you.
4. The breaking changes M3 is making in this round that affect your code.

**Read this if you are about to:** change M3's Cloud Function signatures, add fields to `EventRecord` or `EventVersion`, listen to M3's data, or write to a collection M3 reads from.

---

## 0. The 5 locked decisions (recap)

| # | Decision | Status |
|---|---|---|
| Q1 | Refactor `verifyEventControl` → operate on `event_controls/{id}/stage1_docs/{id}` | locked (this round) |
| Q2 | New admin pages live in `pages/admin/`, reuse the existing `AdminLayout` shell | locked |
| Q3 | "Use Previous" gate is dropped (no A26 condition); Stage 2 image is the backstop | locked (see `M3_GAP_ANALYSIS.md`) |
| Q4 | Add `PublicReport` type to `shared/types.ts` now, no Cloud Function yet | locked (this round) |
| Q5 | M2 exposes `proposeEventControlList` callable; M3 calls it | locked (M2 owner action item) |

---

## 1. What M3 owns (and what we DON'T touch)

| Owned by M3 | Not owned (other modules handle this) |
|---|---|
| Human authority review workflow (initial review, second review, officer assignment) | M2 official risk score, readiness, compliance, advisory |
| Multi-agency decision aggregation | M1 event/version creation, evidence upload, withdrawal |
| Stage 1 control verification (officer) | M4 incident intake, AI severity classification, M4 investigation |
| Stage 2 control verification (public) | M5 analytics aggregations |
| Approved-event publication (`public_events`) | M2 resource recommendation engine |
| Organiser notification | M1 organiser profile / auth |
| Sanitisation of published control documents | M4 escalation outcomes (M3 only listens) |

**Rule of thumb for other module owners:** if your change touches a field M3 owns, open a PR against M3 (or message the M3 owner) before merging. The full field ownership is in `M3_GAP_ANALYSIS.md` §4.

---

## 2. M3's callable Cloud Functions (the M3 API surface)

> **If you're another module and you need any of these, CALL THEM DIRECTLY. Don't re-implement.**

Deployed to `asia-southeast1`, project `linkos-496505`. Callable from any signed-in client (or via Admin SDK with auth context).

| Function | Signature | Notes for callers |
|---|---|---|
| `makeAuthorityDecision` | `(eventId, decision, rationale, confirmedReview?: boolean)` | **CALLABLE BY M3 USERS ONLY** (legacy path; the new officer flow uses `recordOfficerProposal`). Enforces: authority must be in `requiredAuthorities`; status must be in `Pending`/`UnderReview`; `complianceStatus !== 'blocked'` if `decision === 'Approved'`; rationale ≥80 chars if readiness is `provisional`/`insufficient_data`; **FR-M3-16: `confirmedReview: true` required when `decision === 'Approved'`** (UI checkbox drives this). Returns `{ eventId, versionId, decisionId, decision, status, idempotent }`. |
| `recordOfficerProposal` | `({ eventId, decision, reason, suggestion?, confirmedReview?: boolean })` | **SHIPPED (`44a7840` + `7bd47f1`).** The new officer flow (replaces the legacy `makeAuthorityDecision` for assigned officers). Requires an active `assignments/{versionId}_{auth}` doc for the calling officer. `decision === 'Approved'` requires `confirmedReview: true` (FR-M3-16). `decision === 'Rejected'` requires non-empty `suggestion`. Sets `event.reviewStage = 'second'` when all officers complete; emits admin + organiser notifications. Idempotent on `(versionId, authType)`. |
| `makeSecondReviewDecision` | **SHIPPED (`44a7840`).** `({ eventId, confirmedDecision, adminNote? })` | Admin only. Pure aggregator (A7: refuses to override the aggregated decision). Decrements officer workload, writes `decision_made` audit log, writes the `application_approved` / `application_rejected` / `amendment_requested` notification to the organiser with the **featured officer's `reason` + `suggestion` as separate fields** (FR-M3-08). |
| `unassignAuthorityOfficers` | **SHIPPED (`7bd47f1`).** `({ eventId, authorityType? })` | Admin only. Reverses an `assignAuthorityOfficers` call. `authorityType` is optional — when omitted, unassigns all. **Refuses** if any targeted assignment has `status === 'completed'` (a proposal has been recorded; admin must go through `makeSecondReviewDecision` to close out the work). Decrements officer `workloadCount`, writes `assignment_revoked` audit log per revocation, resets `event.reviewStage = null` when all assignments are revoked. Idempotent (revoking an already-revoked assignment is a no-op). |
| `assignAuthorityOfficers` | **SHIPPED (`44a7840` + `7bd47f1`).** `({ eventId, assignmentMap, dryRun? })` | Admin only. Two modes: `dryRun: true` (default) returns the proposed checklist (default-checked by lowest workloadCount + state-scope matching, per A4) without writing. `dryRun: false` commits: writes `events/{id}/assignments/{versionId}_{auth}` per authority, increments each officer's `workloadCount`, sets `event.reviewStage = 'authority'`, writes one `assignment_created` audit log per assignment in the same transaction. Refuses if the event has no required authorities, the event is already in `reviewStage === 'authority'`, any officer is at the workload limit, or any officer is state-scoped to a different venue state. |
| `verifyStage1Doc` | `({ eventId, controlId, docId, status: 'verified'\|'rejected', rationale, evidencePath? })` | **SHIPPED (`ab8b33d`)** — renamed from `verifyEventControl`. Officer must be in `requiredAuthorities` of the event. Operates on `event_controls/{controlId}/stage1_docs/{docId}`; carries provenance (`status`/`verifiedBy`/`verifiedAt`/`rejectionReason`) on the doc itself. Recomputes parent control's aggregate `label`; maintains `event.verifiedControlIds`; writes audit + organiser notification. Idempotent on `(versionId, controlId, docId, authorityType)`. **BREAKING CHANGE** — see §6. |
| `generateEventControlList` | *(this round)* `(eventId, versionId)` | Admin only. Calls M2's `proposeEventControlList` AI proposal (Q5) → admin may edit → system writes `event_controls/{controlId}` with `stage1Docs` + `stage2Docs` template entries. |
| `editEventControlList` | *(this round)* `(eventId, addControls?, removeControlIds?)` | Admin only. Replaces the inline edit UI call. |
| `uploadStage1Doc` | *(this round)* `(eventId, controlId, filePath, usePrevious?: boolean)` | Organiser only. Writes `event_controls/{controlId}/stage1_docs/{docId}` with `status: 'pending_verification'`. If `usePrevious` → `status: 'verified'`, audit `Reused from event X`. |
| `uploadStage2Doc` | *(this round)* `(eventId, controlId, filePath)` | Organiser only. Writes `event_controls/{controlId}/stage2_docs/{docId}` with `status: 'pending_public_confirmation'`. |
| `overrideResources` | `(eventId, quantities, rationale)` | Existing. Officer in `requiredAuthorities`. Captures original + revised + UID + authority + timestamp for audit. |
| `listMyNotifications` | `({ limit?: number })` | **USE THIS for the bell.** Returns `{ items: Notification[], unread: number }`. Scoped to `request.auth.uid`. |
| `markNotificationRead` | `({ notificationId, read?: boolean })` | **USE THIS when the user clicks a notification.** Idempotent. Updates `read` + `readAt`. |
| `publishControlDocument` | *(this round)* `(eventId, controlId, stage: 'stage1'\|'stage2', docId)` | Admin only. Sanitises (strips PII) and writes to `public_event_controls/{eventId}/{controlId}`. |
| `confirmStage2Doc` | *(this round)* `(eventId, controlId, docId)` | Any signed-in user. Rate-limited: 1 confirmation per user per doc. Increments `publicConfirmCount`. |
| `reportStage2Doc` | *(this round)* `(eventId, controlId, docId, category, description)` | Any signed-in user. Rate-limited: 1 report per user per doc. Writes to M4's intake (or `public_reports/{id}` if M4 isn't ready). |
| `onM4ReportOutcome` | *(this round, Firestore trigger)* listens to `public_reports/{id}.update` | Server-only. When `outcome: 'confirmed_true'` → marks control `Resubmit Required`. When `outcome: 'dismissed_fake'` → restores to `Approved`. Writes to `event_controls/{controlId}` + organiser notification. |
| `onEventStatusChanged` | *(this round, Firestore trigger)* listens to `events/{id}.update` | Server-only. When `status: 'Withdrawn'` → FR-M3-01 cleanup: unpublishes control docs, closes pending reviews, retains records. |
| `onEventApproved` | *(this round, Firestore trigger)* listens to `events/{id}.update` | Server-only. When `status: 'Approved'` (post-second-review) → kicks off `generateEventControlList` for the admin to review. |

**Direct-use note for other modules:**
- M1 — if you ever need to know "did this event get an authority decision?", call `listMyNotifications` (scoped to the organiser UID) from your side OR query the `events/{id}/decisions` subcollection directly.
- M2 — your callable surface must include `proposeEventControlList` (see §4).
- M4 — write to `public_reports/{id}` for M3 to pick up (see §4).

---

## 3. M3's data schema (the read surface for other modules)

Read-by-rules is already configured. Writes are server-only.

### Top-level collections M3 writes

#### `notifications/{notificationId}`
```ts
{
  notificationId: string,         // = sourceActionId
  recipientUid: string,            // user who sees the bell badge
  eventId: string,
  versionId?: string,
  type: 'decision_made' | 'application_approved' | 'application_rejected'
      | 'amendment_requested' | 'control_verified' | 'control_rejected'
      | 'stage1_doc_approved' | 'stage1_doc_rejected'        // Q1 refactor
      | 'control_list_published' | 'control_resubmit_required' | 'control_restored'  // planned
      | 'withdrawn_cleanup',                                     // planned
  title: string,
  message: string,
  sourceActionId: string,          // idempotency key
  read: boolean,
  createdAt: number,
  readAt?: number,
  // FR-M3-08 (SHIPPED `7bd47f1`): rejection / second-review
  // notifications carry the reason and suggestion as separate,
  // structured fields (not just mashed into `message`). The bell UI
  // surfaces them on separate lines. Optional for legacy /
  // non-rejection notifications — old docs without these fields
  // degrade gracefully.
  reason?: string,
  suggestion?: string,
}
```
**Other modules:** subscribe to the relevant `recipientUid` to surface notifications in your own UI if needed. When writing a notification that has a reason / suggestion, **pass them as separate fields**, not just into the `message`. The bell UI surfaces them on separate lines.

#### `events/{eventId}/event_controls/{controlId}` (existing flat) → `event_controls/{controlId}/stage1_docs/{docId}` + `stage2_docs/{docId}` (this round)
```ts
// Per-control item doc
{
  controlId: string,
  eventId: string,
  versionId: string,
  controlName: string,
  authority: 'PDRM' | 'BOMBA' | 'KKM' | 'DBKL' | 'MOTAC',
  stageRequirement: 'stage1_only' | 'stage1_and_stage2',
  controlItemVersion: number,        // bumped on resubmission
  usePreviousSourceEventId?: string, // audit only
  publicConfirmCount: number,
  label: 'approved' | 'pending' | 'reported_under_review' | 'resubmit_required',
  labelAddedAt?: number,
  labelRemovedAt?: number,
}

// Stage 1 doc subcollection
{
  docId: string,
  docType: 'receipt' | 'application' | 'floor_plan' | 'license' | 'insurance' | 'other',
  label: string,                     // human-readable
  uploadedAt?: number,
  uploadedBy?: string,
  filePath: string,                  // Firebase Storage path
  status: 'pending_submission' | 'pending_verification' | 'verified' | 'rejected' | 'use_previous',
  usePreviousSourceEventId?: string,
  verifiedBy?: string,
  verifiedAt?: number,
  rejectionReason?: string,
  rejectionSuggestion?: string,
}

// Stage 2 doc subcollection
{
  docId: string,
  imageUrl: string,                  // public, hosted in storage
  uploadedAt: number,
  uploadedBy: string,
  publicConfirmCount: number,
  reportedAt?: number,
  m4TicketId?: string,
  published: boolean,
  publishedAt?: number,
  publishedBy?: string,
}
```

**Other modules:** this is the canonical Stage 1/2 shape (matches the planned shape in `frontend/src/mock_data/controls.ts`). M2's AI proposal returns a list of *control items*; M3 writes the items + empty Stage 1 + Stage 2 doc arrays; organiser fills them.

#### `events/{eventId}/decisions/{authorityType}` (existing)
```ts
{
  decisionId, eventId, versionId, authorityType, decision, rationale,
  reviewerId, decidedAt, current: boolean,
}
```
**Other modules:** read for analytics (M5), organiser UI (M1), audit history.

#### `public_events/{eventId}` (existing)
```ts
{
  eventId, versionId, eventName, venueName, eventType, startDatetime, endDatetime,
  approvedBy: AuthorityType[], publicStatus: 'approved',
}
```
**Other modules:** M1's public calendar reads this. M5 may read for analytics. Don't write to it.

#### `public_event_controls/{eventId}/{controlId}/{stage}/{docId}` *(this round)*
```ts
// Sanitised public view of a verified Stage 1 or Stage 2 doc
{
  eventId, controlId, stage, docId,
  controlName, authority, label,                  // metadata, no PII
  imageUrl?: string,                              // stage 2 only
  receiptRedactedUrl?: string,                    // stage 1 receipt — amounts/IDs redacted
  publishedAt, publishedBy,
  // NO: uploader phone, organiser email, raw file path
}
```
**Other modules:** the public viewer UI reads this. Don't write to it.

#### `public_reports/{ticketId}` *(this round, see Q4)*
```ts
{
  ticketId, eventId, controlId, docId,
  reporterUid, category, description, evidencePaths?: string[],
  outcome?: 'confirmed_true' | 'dismissed_fake' | 'under_review',
  outcomeNotes?: string,
  outcomeSetBy?: string,
  outcomeSetAt?: number,
  createdAt, updatedAt,
}
```
**Other modules (M4):** this is your hand-off target. M3 creates the doc when a public user reports a Stage 2 image. You (M4) update `outcome` after investigation. M3 listens (via the `onM4ReportOutcome` trigger) and updates the control item's `label` accordingly.

**M3 owner decision: when M4 isn't ready, the `reportStage2Doc` callable creates a doc with `outcome: 'under_review'` in `public_reports/{id}` and writes a holding entry. M4 can later ingest these (read all `public_reports where outcome == 'under_review'`) and process them. The shape is stable either way.**

---

## 4. What M3 needs from each other module

### M1 (User & Event Management)

**M3 reads:**
- `events/{eventId}.eventDetails.venueId` — for the officer-assignment default-check (UC-09, A4).
- `events/{eventId}.eventDetails.venueName` — display in admin/review pages.
- `events/{eventId}.organizerId` — to address notifications.
- `users/{uid}.role`, `users/{uid}.state`, `users/{uid}.scopeType` — for the officer checklist.

**M3 needs from you (M1):**
- **New fields on `users/{uid}`** (when you add them, also add to your seeder and the registration form):
  - `state?: string` — the state the officer covers (e.g., `'Selangor'`, `'Kuala Lumpur'`).
  - `scopeType: 'state' | 'federal'` — for the default-check (federal officers are always in scope).
  - `workloadCount: number` — incremented when an event is assigned; used by the workload-based default-check (A4).
- **Trigger on `events/{id}.update`** — M3 has installed `onEventStatusChanged` that listens for `status: 'Withdrawn'`. **M1 owner: don't write to `status` directly from client code; route through the existing `withdrawEvent` callable.** When M3 sees `Withdrawn`, it auto-cleans (FR-M3-01).
- **`requiredAuthorities` on `eventDetails`** — keep as-is. M3 reads it for permission checks.

**Already in M1, M3 uses directly:**
- `submitEvent`, `withdrawEvent` callables — M3 doesn't call these but inherits the event state they produce.
- `eventDetails.organizerEmail`, `eventDetails.organizerPhone` — display in the M3 audit log.

### M2 (Risk Assessment)

**M3 reads:**
- `events/{eventId}/assessments/{versionId}.complianceStatus` — for the Approve gate.
- `events/{eventId}/assessments/{versionId}.assessmentReadiness` — for the rationale-length gate.
- `events/{eventId}/assessments/{versionId}.officialRiskLevel`, `.officialScore` — display in the review page.
- `events/{eventId}/resources/{versionId}` — the resource recommendation.
- `events/{eventId}.verifiedControlIds` — *you* (M2) read this when recalculating residual hazards. **M3 writes to this field.** (Already in production.)

**M3 needs from you (M2):**
- **A new callable: `proposeEventControlList({eventId, versionId})`** *(Q5, M2 owner action)*
  - Input: the approved event + version + official risk + resource recommendation.
  - Process: ask MiniMax to generate a proposed list of Stage 1 / Stage 2 control items based on the residual hazards + venue profile + attendance.
  - Output: `{ items: ProposedControlItem[] }` where each item has:
    ```ts
    {
      controlName: string,
      authority: 'PDRM'|'BOMBA'|'KKM'|'DBKL'|'MOTAC',
      stageRequirement: 'stage1_only'|'stage1_and_stage2',
      stage1Requirements: Array<{ docType, label, required: boolean }>,
      stage2Requirement: { kind: 'image', label: string } | null,
    }
    ```
  - Should reuse your existing MiniMax wrapper (`functions/src/http/minimax.ts` or wherever the hazard proposal lives) — do not duplicate the API connection.

- **Manual Review Required status** — per FR-M3-03: when AI is unavailable, M2 sets `status: 'Manual Review Required'` (or similar) on the event. **M3 owner question (for M2):** what's the exact field name and value? Currently M2's `onEventCreated` sets `status: 'UnderReview'` as a fallback. We need a distinct signal.

- **Compliance/readiness schema** — already in place, no change needed.

### M4 (Incident Reporting)

**M3 needs from you (M4):**
- **The `public_reports/{ticketId}` shape (Q4):** M3 writes the doc; you (M4) update `outcome` after investigation. The contract is fixed in §3.
- **A webhook or pub/sub** *(if you have one)* — for `public_reports/{id}.update`. M3's Firestore trigger `onM4ReportOutcome` listens to this. If you can't write to `public_reports`, tell M3 your preferred channel.
- **M4 investigation timeline** — when M3 marks a control `Resubmit Required`, the organiser needs a deadline. Suggest ~7 days (matches A22's "before event start" rule). M3 will write the deadline into the notification message.

**M3 provides to you (M4):**
- All Stage 2 inaccurate reports appear as `public_reports/{id}` docs. M4's intake is this collection.
- M3 emits a `notification` to the admin when an `outcome` arrives. You can use this as a "M4 is responding" signal in the admin UI.

### M5 (Analytics)

**M3 needs from you (M5):**
- **The Event Control Compliance Analysis Report (FR-M5-13):** counts of control items by status (`pending_submission`, `pending_verification`, `verified`, `rejected_resubmit_required`, `exempted_via_use_previous`). When this report lands, it reads from `event_controls/{id}` + `stage1_docs/{id}`.

**M3 provides to you (M5):**
- `events/{id}/decisions/{authType}` — for decision outcome analytics.
- `events/{id}/event_controls/{id}` + sub-collections — for control compliance analytics.
- `notifications/{id}` — if M5 wants to measure "decision notification latency" or similar.

---

## 5. The Q1 refactor — SHIPPED (`ab8b33d`)

> **The big one — now live.** `verifyEventControl` is renamed + restructured to `verifyStage1Doc` operating on per-doc sub-collections. Any current caller (UI smoke test, the existing `evt-control-verification` test fixture, the mock seeder) must be updated. Done in this commit.

**Before (pre-Q1):**
- Path: `events/{eventId}/event_controls/{controlId}`
- Function: `verifyEventControl({ eventId, controlId, status, rationale, evidencePath? })`

**After (now on `anny_cont`):**
- Path: `events/{eventId}/event_controls/{controlId}/stage1_docs/{docId}`
- Function: `verifyStage1Doc({ eventId, controlId, docId, status, rationale, evidencePath? })`
- Stage 1 doc carries provenance on itself: `{ status, verifiedBy, verifiedAt, rejectionReason }`. No more `ControlVerification` interface or `control_verifications` sub-collection.

**What changed for other modules / tests:**
- If you read `event_controls/{controlId}` to check verification status → use `event_controls/{controlId}.label` for the *item* status (the function recomputes this from its stage1 docs: any rejected → `resubmit_required`; all verified/use_previous → `approved`; else `pending`).
- If you wrote a `event_controls/{id}` doc directly in a seeder or test → also seed `event_controls/{id}/stage1_docs/{id}` (status: `pending_verification`) so the verification has something to operate on. The `seedEventControls` helper in `frontend/tests/m3/global-setup.ts` does this for all UAT events with non-empty `requiredAuthorities`.
- The parent event's `verifiedControlIds` is still maintained (now sourced from a different sub-collection). M2's read of that field still works.

**Migration status (all done in `ab8b33d`):**
- [x] Round 1: rename Cloud Function, update `AuthorityEventReview.tsx` UI to use the new path, update `firestore.rules` for the new subcollection, update `shared/types.ts` (dropped `ControlVerification` + `COLLECTIONS.CONTROL_VERIFICATIONS`; added `stage1_doc_approved` / `stage1_doc_rejected` to `NotificationType`), migrate `evt-control-verification` test seed.
- [x] Round 2: deleted the old flat `verifiedControlIds` logic from `verifyEventControl` (function removed). Old `event_controls/{id}` flat-doc shape gone.
- [ ] Round 3 (post-merge): clean up legacy data via Admin SDK one-shot script. Not blocking — only matters once we cut a release with prior data.

**Verification:** 35/35 M3 Playwright specs pass as of the Workstream 1 polish round (`7bd47f1` + `683a108`): m3-smoke 13/13, m3-full 15/15, m3-workstream1 7/7. The 3-project split (commit `777bb55`) keeps cumulative Firebase Auth slowness from flaking the new per-doc tests.

**Notification:** other modules don't need to migrate. Only the test fixture and the existing Playwright spec needed updating. M2's `verifiedControlIds` read still works (same field on the parent event doc, just sourced from a different sub-collection).

---

## 6. The Q4 type addition — no code, just a contract

`shared/types.ts` will gain a `PublicReport` interface (see §3). No Cloud Function, no trigger, no migration. M4 can write docs of this shape and M3's future `onM4ReportOutcome` trigger will pick them up.

**M4 owner action:** when you build the investigation workflow, ensure your final-state write includes:
```ts
{
  outcome: 'confirmed_true' | 'dismissed_fake',
  outcomeNotes: string,
  outcomeSetBy: string,   // the investigating authority UID
  outcomeSetAt: number,
}
```
M3's trigger will read those four fields and update the control item's `label` + emit a notification.

---

## 7. The Q5 contract — what M2 needs to build

This is the **single most important cross-module action item for M2** in this round. M2 owner, please add:

### New callable: `proposeEventControlList`

**Path:** `functions/src/http/` (M2's directory).

**Signature:**
```ts
proposeEventControlList: httpsCallable<{
  eventId: string;
  versionId: string;
}, {
  items: Array<{
    controlName: string;
    authority: 'PDRM'|'BOMBA'|'KKM'|'DBKL'|'MOTAC';
    stageRequirement: 'stage1_only'|'stage1_and_stage2';
    stage1Requirements: Array<{ docType: Stage1DocType; label: string; required: boolean }>;
    stage2Requirement: { kind: 'image'; label: string } | null;
  }>;
}>
```

**Behaviour:**
1. Read `events/{eventId}/assessments/{versionId}` for the official risk + residual hazards.
2. Read `events/{eventId}/resources/{versionId}` for the resource recommendation.
3. Build a MiniMax prompt (reuse your existing `aiPredictor.ts` wrapper):
   ```
   You are generating a Stage-1/Stage-2 event control list for a [eventType] event
   at [venueName] expecting [expectedAttendance] attendees.
   Official risk: [officialRiskLevel] ([officialScore]).
   Top residual hazards: [hazardList].
   Resource plan: [resourceList].
   Propose 3-7 control items, each with the responsible authority, the
   process documentation required (Stage 1), and the visual evidence
   required (Stage 2).
   ```
4. Parse + validate the response (your existing JSON schema + hard-rule constraints).
5. Return `{ items: [...] }`. If the AI is unavailable, return `{ items: [] }` and log; M3 will fall back to a default list.

**Why M2 owns this:**
- The AI provider is the same as M2's hazard analysis.
- The input data (hazards, resources, venue) is all M2-owned.
- The output (proposed items) is M3's input — clean module split.

**M3's caller (workstream 2):**
```ts
const proposal = await httpsCallable(functions, 'proposeEventControlList')({ eventId, versionId });
// Admin can edit, then M3 writes event_controls/{controlId} with the agreed list
```

**Reuse note:** M3's `generateEventControlList` Cloud Function (this round) calls into this. It does not duplicate the AI prompt or the validation.

---

## 8. Notification contract (organiser + admin + officer)

M3 owns `notifications/{id}` writes. Other modules don't need to write here.

**Event M3 emits notifications for (post-this-round):**

| Trigger | type | recipientUid |
|---|---|---|
| `makeAuthorityDecision` records (any decision) | `decision_made` | organiser |
| All required authorities approved (aggregate) | `application_approved` | organiser |
| Any authority rejected (aggregate) | `application_rejected` | organiser |
| Any authority requested amendment (aggregate) | `amendment_requested` | organiser |
| `verifyStage1Doc` verified | `stage1_doc_approved` | organiser |
| `verifyStage1Doc` rejected | `stage1_doc_rejected` | organiser |
| `publishControlDocument` | `control_list_published` | organiser |
| `onM4ReportOutcome` confirmed_true | `control_resubmit_required` | organiser |
| `onM4ReportOutcome` dismissed_fake | `control_restored` | organiser + admin |
| `onEventStatusChanged` → `Withdrawn` | `withdrawn_cleanup` | admin + organiser |
| Officer assigned to event | *(new)* `assignment_received` | officer |
| Officer assignment revoked (mid-review) | *(new)* `assignment_revoked` | officer |

**Shape contract:** the `Notification` interface in `shared/types.ts` (already exists). New types added this round are listed above.

**M1 owner:** if you want to surface these in the organiser dashboard, call `listMyNotifications` (it's already callable). The bell UI in `WorkspaceTopBar` is M3's; the dashboard card is yours.

**M4 owner:** when you `outcome: 'confirmed_true'`, the organiser gets `control_resubmit_required`. When you `outcome: 'dismissed_fake'`, the organiser + admin both get `control_restored`. The notification body is generic — it doesn't expose M4 investigation details (privacy).

---

## 9. Status transition contract

The event lifecycle now has a longer state machine. **M1 owner: do not write to `status` directly from client code** beyond `Draft` / `Pending` / `Withdrawn` (the existing client-writable path). All other transitions are server-driven.

```
Draft (M1)                ← organiser creates
  └─→ Pending              ← M1.submitEvent
        └─→ UnderReview     ← first authority action (existing) or admin approval
              ├─→ AmendmentRequested  ← any officer amendment
              │     └─→ (organiser revises → Pending v2)
              ├─→ Rejected            ← any officer rejection
              │     └─→ (organiser revises → Pending v2)
              └─→ UnderSecondReview   ← admin opens second review (NEW, this round)
                    ├─→ Approved       ← admin final approval (NEW)
                    │     └─→ onEventApproved trigger → kick off generateEventControlList
                    │           └─→ Stage 1/2 workflow (UC-22..38)
                    └─→ Rejected       ← admin second-review reject (NEW)
                          └─→ (organiser revises → Pending v2)
Withdrawn                 ← M1.withdrawEvent (anytime post-Pending)
  └─→ onEventStatusChanged trigger → FR-M3-01 cleanup
```

**M1 owner: please do not bypass the callables. Direct `status: 'Withdrawn'` writes from the client will still trigger the cleanup trigger, but the audit log will be wrong (no withdrawal reason, no timestamp provenance).** Same for direct writes to `status: 'Approved'` — only M3's `makeSecondReviewDecision` should produce those.

---

## 10. M3 → other modules — what we owe you

| What | When | Where |
|---|---|---|
| Q1 refactor: `verifyEventControl` → `verifyStage1Doc` on a doc sub-collection | **SHIPPED** (`ab8b33d`) | `functions/src/http/verifyStage1Doc.ts` (renamed + new path) + `shared/types.ts` (Stage 1 doc types) + `frontend/src/pages/authority/AuthorityEventReview.tsx` (per-doc UI) |
| Q4: `PublicReport` type | SHIPPED (`bf79619`) | `shared/types.ts` |
| Workstream 1: officer assignment Cloud Function (`assignAuthorityOfficers`) | **SHIPPED** (`44a7840`) | `functions/src/http/assignAuthorityOfficers.ts` + `frontend/src/pages/admin/AdminAssignment.tsx` |
| Workstream 1: `makeSecondReviewDecision` Cloud Function | **SHIPPED** (`44a7840`) | `functions/src/http/makeSecondReviewDecision.ts` |
| Workstream 1 polish: `unassignAuthorityOfficers` Cloud Function (A15 backup officer swap) | **SHIPPED** (`7bd47f1`) | `functions/src/http/unassignAuthorityOfficers.ts` + per-row "Unassign" buttons in `AdminAssignment.tsx` |
| Workstream 1 polish: audit log for assignment actions (FR-M3-09..12) | **SHIPPED** (`7bd47f1`) | `assignAuthorityOfficers` writes one `assignment_created` audit per officer; `unassignAuthorityOfficers` writes one `assignment_revoked` per revocation. New `AuditAction` values: `'assignment_created'`, `'assignment_revoked'`. |
| Workstream 1 polish: FR-M3-16 officer approval checkbox | **SHIPPED** (`7bd47f1`) | `recordOfficerProposal` and the legacy `makeAuthorityDecision` both refuse `Approve` unless `confirmedReview: true`. UI checkbox in `AuthorityEventReview.tsx`. |
| Workstream 1 polish: FR-M3-08 reason + suggestion split fields in notifications | **SHIPPED** (`7bd47f1`) | `Notification` interface gains `reason?: string` and `suggestion?: string`. `createNotification` helper accepts them; `makeSecondReviewDecision` and `recordOfficerProposal` pass them as separate fields. `NotificationBell.tsx` surfaces them on separate lines. |
| Workstream 1 polish: per-row "Assign" link in `/admin/applications` queue | **SHIPPED** (`7bd47f1`) | `AdminApplicationQueue.tsx` row gets a per-row "Assign" link. |
| Workstream 2: `generateEventControlList` + `editEventControlList` + new admin page `AdminControlListEditor` | Round after | `functions/src/http/controlList.ts` + `frontend/src/pages/admin/AdminControlListEditor.tsx` |
| Workstream 3: `uploadStage1Doc` + `usePrevious` + organiser page | Round after | `functions/src/http/stage1Upload.ts` + `frontend/src/pages/organizer/EventControls.tsx` |
| Workstream 4: `confirmStage2Doc` + `reportStage2Doc` + public UI | Round after | `functions/src/http/stage2Public.ts` + extension to `frontend/src/pages/public/PublicEventDetail.tsx` |
| Workstream 5: `publishControlDocument` + `AdminPublishControls` | Round after | `functions/src/http/publishControls.ts` + `frontend/src/pages/admin/AdminPublishControls.tsx` |
| Workstream 6: `onM4ReportOutcome` trigger (depends on M4 shape) | When M4 lands | `functions/src/triggers/onM4ReportOutcome.ts` |
| `onEventStatusChanged` (Withdrawn cleanup) | This round | `functions/src/triggers/onEventStatusChanged.ts` |
| `onEventApproved` (kick off control list) | Round after | `functions/src/triggers/onEventApproved.ts` |

**Commits to watch for on `anny_cont`:** I'll prefix all M3 round N+1 commits with `[m3-integration]` in the message so other module owners can grep them easily.

---

## 11. Integration risks (call out before we start)

| Risk | Mitigation |
|---|---|
| M2 doesn't have time to add `proposeEventControlList` this round | M3 falls back to a hardcoded default control list (one per authority in `requiredAuthorities`). M3 patches the M2 owner block in. |
| M4 won't have `public_reports` write capability ready when Workstream 4 lands | M3's `reportStage2Doc` writes the doc directly with `outcome: 'under_review'`. M4 reads from this collection on its own timeline. |
| The `users` collection doesn't have `state` / `scopeType` / `workloadCount` yet (M1 territory) | M3 can't ship Workstream 1 without these. Either (a) M1 owner adds the fields, or (b) M3 stubs them and `AdminAssignment` shows a hardcoded checklist. (a) is the right answer. |
| The `evt-control-verification` test fixture (and the existing Playwright spec) reference the old `verifyEventControl` path | **RESOLVED** in `ab8b33d`. The new test fixture (via `seedEventControls` in `global-setup.ts`) seeds `event_controls/{id}/stage1_docs/{id}` for all UAT events with non-empty `requiredAuthorities`. The `verifyStage1Doc` spec replaces the old `verifyEventControl` spec. |
| The `verifyEventControl` smoke spec (2 passing tests) breaks under Q1 | Replace with `verifyStage1Doc` smoke spec in the same PR. |

---

## 12. Open questions for the other module owners

These should be answered before the next round starts.

### For M1 owner
1. Can you add `state`, `scopeType: 'state'|'federal'`, `workloadCount` to `users/{uid}`? (For Workstream 1.)
2. Can you add `users.countByState` materialised count, or should M3 query directly? (For the workload-based default-check.)
3. Will the `Withdrawn` withdrawal reason be stored on the event doc or in a separate audit log? (M3's cleanup trigger wants the reason in the notification.)

### For M2 owner
1. **Critical:** can you add the `proposeEventControlList` callable (Q5)? If not, M3 falls back to a hardcoded list for the demo.
2. What's the exact `status` value you set when AI is unavailable? (FR-M3-03 needs a "Manual Review Required" signal distinct from `UnderReview`.)
3. Does your MiniMax wrapper expose a `temperature` / `model` parameter we can tune for the control list proposal? (Less critical.)

### For M4 owner
1. What's your investigation timeline expectation? (M3's `Resubmit Required` notification needs a deadline.)
2. When you build the investigation workflow, will your write to `public_reports/{id}` include all four required fields (`outcome`, `outcomeNotes`, `outcomeSetBy`, `outcomeSetAt`)?
3. If M4 is built before Workstream 6, do you have a pub/sub channel for `public_reports` updates, or should M3 rely on the Firestore trigger?

### For M5 owner
1. When you build the Event Control Compliance Analysis Report (FR-M5-13), do you want the new `event_controls/{id}/stage1_docs/{id}` shape, or the existing flat `event_controls/{id}.status`? (M3 recommends the sub-collection shape — it's richer.)
2. The `controlItemVersion` field is bumped on every resubmission. Do you want per-version analytics, or just latest?

---

**Bottom line for the other module owners:** M3 is moving fast this round. Two of the five locked decisions need action from you:
- **M2:** build `proposeEventControlList` (Q5). This is the highest-leverage integration.
- **M1:** add the user-profile fields for the officer assignment (Q2 dependency).

Everything else is M3's own work; you can ignore it until you need to consume the new callable surface or read the new collections.

---

**Document version:** 1.0 (locked against 5 Qs on 2026-08-17)
**Next review:** when Workstream 1 (officer assignment) is designed — the M1 user-fields question (§12) must be resolved by then.
