# M3 — Workstream 1 Polish Plan

**Date:** 2026-08-18
**Owner:** M3 teammate (Chia Yu Xin)
**Branch:** `anny_cont` (carried over — NOT merged to main until you signal)
**Goal:** Close the 5 remaining Workstream 1 polish gaps (audit log, queue link, FR-M3-16 checkbox, FR-M3-08 split fields, unassign swap) in a single tight pass. Defer Workstream 1's bigger sibling ("Initial Review" / FR-M3-02..04) to its own round.

---

## 0. Scope decision (please confirm before I code)

The original list had **6** polish items. They sort into two buckets:

| # | Item | Size | In scope? |
|---|---|---|---|
| 1 | `makeInitialReviewDecision` (FR-M3-02/03/04, manual review path) | **Large** — new `reviewStage: 'initial'`, new admin form, multi-day | ❌ **Defer.** This is its own workstream (UC-01/02/03/04/05/06/07 — 7 UCs). New round. |
| 2 | `unassignAuthorityOfficer` (A15 backup officer swap) | **Small-Medium** — 1 new function + UI button | ✅ **In** |
| 3 | Audit log entries for assignment actions (FR-M3-09..12) | **Small** — 2 audit writes + 1 type | ✅ **In** |
| 4 | Link from `/admin/applications` queue to assignment page | **Small** — 1 button per row | ✅ **In** |
| 5 | FR-M3-16 officer approval checkbox | **Small** — 1 new required field | ✅ **In** |
| 6 | FR-M3-08 reason+suggestion split fields in notifications | **Small-Medium** — type ripple, UI ripple, all callers | ✅ **In** |

**My recommendation: ship 2–6 in one pass, defer 1 to its own round.** If you want 1 included too, say so and I'll plan it separately — it's a much bigger lift.

---

## 1. Why I'm deferring #1

`makeInitialReviewDecision` is the multi-stage split (`Pending → Initial Review → Authority Review → Second Review → Approved`). It needs:

- A new `EventStatus: 'UnderInitialReview'` + a new `reviewStage: 'initial'`.
- `assignAuthorityOfficers` precondition: only callable when `reviewStage === 'initial'`.
- `recordOfficerProposal` precondition: only callable when `reviewStage === 'authority'`.
- `makeSecondReviewDecision` precondition: only callable when `reviewStage === 'second'`.
- New `AdminInitialReview` page + `makeInitialReviewDecision` Cloud Function.
- New `AdminManualAssessment` page for FR-M3-04 (Manual Review Required).
- Updates to all existing tests to drive events to `UnderInitialReview` first.
- Updates to the seed (`global-setup.ts`) to start events in `UnderInitialReview` instead of `UnderReview`.

That's a fresh workstream, not polish. Better as its own plan with its own test cycle.

---

## 2. The 5 polish items — concrete plan

### #3 — Audit log entries for assignment actions (FR-M3-09..12)

**Current state:** `assignAuthorityOfficers` writes assignments + bumps workload, but doesn't write an audit log. No way to answer "who assigned Officer X to Event Y at time T?".

**Plan:**

- `shared/types.ts`: add `|'assignment_created' | 'assignment_revoked'` to `AuditAction`.
- `functions/src/http/assignAuthorityOfficers.ts`: in the commit-mode transaction, after the `tx.set(assignmentRef, ...)`, write one audit log per assignment:
  ```ts
  tx.create(eventRef.collection(COLLECTIONS.AUDIT_LOGS).doc(`${auditId}_assigned`), {
    id: `${auditId}_assigned`,
    eventId, versionId, action: 'assignment_created',
    actorId: request.auth!.uid, actorRole: 'admin', timestamp: now,
    notes: `Assigned ${officerUid} as ${auth} officer`,
    metadata: { authorityType: auth, officerUid, officerWorkload: officer.workloadCount + 1 },
  });
  ```
  (auditId = `${versionId}_${auth}_${now}`)

**Test:** extend `officer-assignment.spec.ts` "full flow" to read `audit_logs` and assert one `assignment_created` per officer with the right `actorId`/`actorRole`.

---

### #2 — `unassignAuthorityOfficer` (A15 backup officer swap)

**Current state:** The `revoked` status is already in the type and the `recordOfficerProposal` flow already treats revoked-as-completed for reviewStage advancement. But there's no way to actually create a `revoked` assignment. The current `assignAuthorityOfficers` explicitly refuses to re-assign: *"Officers are already assigned for this event version. Unassign first to re-assign."* — the function doesn't exist.

**Plan:**

- `functions/src/http/unassignAuthorityOfficers.ts` (new): admin-only, takes `{ eventId, authorityType? }` (omit authorityType to unassign all).
  - Refuse if `event.reviewStage !== 'authority'` (nothing to unassign).
  - Refuse if any of the targeted assignments has `status === 'completed'` (officer already proposed; unassign would lose data; admin must go through `makeSecondReviewDecision` or wait for the officer to revise).
  - Transaction: read all matching assignments + officer refs, then for each: write `status: 'revoked'`, `revokedAt: now`, `revokedBy: uid`; decrement officer `workloadCount`; write one `assignment_revoked` audit log; if all targeted, set `event.reviewStage = null`.
  - Returns `{ revoked: number, byAuthority: Record<AuthorityType, boolean> }`.
- `functions/src/index.ts`: export the new function.
- `shared/types.ts`: already has `revoked` status + `revokedAt` + `revokedBy` — no change.
- `frontend/src/pages/admin/AdminAssignment.tsx`:
  - Add an "Unassign" button (per-row for single authority, or top-level for all).
  - Visible when `event.reviewStage === 'authority'` AND no officer has yet recorded a proposal.
  - On click: confirm dialog, then call `unassignAuthorityOfficers({ eventId, authorityType? })`. Toast on success.

**Test:** new spec `unassign-officer.spec.ts` (or extend `officer-assignment.spec.ts`):
- Assign all 4 → unassign PDRM only → assert 3 assignments remain, PDRM assignment has `status: 'revoked'`, PDRM officer's `workloadCount === 0`, others stay at 1, `event.reviewStage` stays `'authority'`.
- Assign all 4 → unassign all → assert all 4 revoked, all workload decremented, `event.reviewStage === null`.
- Assign + record 1 proposal → unassign PDRM → expect HttpsError `failed-precondition`.

---

### #5 — FR-M3-16 officer approval checkbox

**Current state:** The PRD says officers approving must tick a checkbox confirming "review of all listed materials". The `AuthorityEventReview.tsx` "Your decision" Approve button is the entry point. The Cloud Function (`makeAuthorityDecision`) doesn't check for confirmation.

**Plan:**

- `functions/src/http/recordOfficerProposal.ts`: add `confirmedReview?: boolean` to `RecordOfficerProposalRequest`. When `decision === 'Approved'`, require `confirmedReview === true` (HttpsError `failed-precondition` with the exact PRD wording).
- `functions/src/http/authorityDecision.ts`: same for the legacy path (defensive — the legacy path is being replaced by the new flow but is still callable today).
- `frontend/src/pages/authority/AuthorityEventReview.tsx`:
  - New state: `const [confirmedReview, setConfirmedReview] = useState(false)`.
  - New checkbox in the "Your decision" section, above the Approve button:
    ```tsx
    <label className="flex items-start gap-2 text-xs text-ink-600">
      <input type="checkbox" checked={confirmedReview} onChange={(e) => setConfirmedReview(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
      <span>I confirm I have reviewed the assessment, advisory, evidence, and resource recommendation for this application.</span>
    </label>
    ```
  - Update `canDecide` to include `confirmedReview` (or split: `canApprove` requires the checkbox; `canReject` / `canAmend` don't).
  - Reset to `false` on submit.
  - Pass `confirmedReview: true` in the request body for `Approved`.

**Test:** extend `officer-assignment.spec.ts`:
- Officer tries to `recordOfficerProposal({ decision: 'Approved' })` without `confirmedReview` → HttpsError `failed-precondition`.
- With `confirmedReview: true` → success. Update the existing "full flow" spec to include the field (otherwise it'll fail when this ships).

**Note on legacy path:** If `makeAuthorityDecision` is still callable for non-assigned authorities in some edge case, the same checkbox gate applies. I'll add it symmetrically.

---

### #6 — FR-M3-08 reason+suggestion split fields in notifications

**Current state:** The `Notification` interface has only `message: string`. `recordOfficerProposal` and `makeSecondReviewDecision` already have `reason` + `suggestion` separately, but they get concatenated into the `message` (and `suggestion` is dropped on some paths). The organizer can't see them as separate, structured fields.

**Plan:**

- `shared/types.ts`: add `reason?: string; suggestion?: string;` to `Notification` interface (both optional, non-breaking for existing data).
- `functions/src/utils/notifications.ts`: extend `CreateNotificationInput` to accept `reason` and `suggestion` and pass them through to the doc write.
- All callers that have reason+suggestion should pass them as separate fields:
  - `recordOfficerProposal.ts`: pass `reason` + `suggestion` separately (the rejection path, when `decision === 'Rejected'`).
  - `makeSecondReviewDecision.ts`: pass the featured officer's `reason` + `suggestion` separately.
  - `authorityDecision.ts`: has only `rationale`, not split — keep as `reason` (no `suggestion` since the legacy path doesn't require one).
- `frontend/src/components/layout/NotificationBell.tsx`: in the dropdown, render the `reason` and `suggestion` as separate lines under the message (small italic, slightly indented). If both are missing, no change.
- `firestore.rules`: no change (notifications are still server-write only).
- Migration: existing notifications (without reason/suggestion) keep showing as today. New notifications carry the fields.

**Test:** extend `m3-controls-notifications.spec.ts` or add a new spec:
- After the 4-officer approve flow, organizer's `listMyNotifications` for the second-review approval should include a `reason` and a `suggestion` on the `application_approved` notification (and the `featuredOfficerUid` from `event.secondReview` should match one of the 4 officers).
- After a rejection: organizer's `application_rejected` notification should have `reason` and `suggestion` populated (currently only `message` has them mashed together).

---

### #4 — Link from `/admin/applications` queue to assignment page

**Current state:** `AdminApplicationQueue.tsx` only links to `/admin/applications/:id` (the review page). The review page has a small "Open officer assignment" link at the bottom (line 622 of `AdminApplicationReview.tsx`). The user wants a direct link from the queue.

**Plan:**

- `frontend/src/pages/admin/AdminApplicationQueue.tsx`: in each row, add a small "Assign" button on the right edge (or a chevron) that links to `/admin/applications/${e.eventId}/assign`. Hidden if `event.reviewStage === 'second'` (already past assignment) or status is `Approved`/`Rejected` (closed).
- Read `event.reviewStage` from the event doc (already loaded for the queue).

**Test:** new spec or extend a queue spec. The queue page is currently untested by Playwright. Manual verification first; add a Playwright spec only if the user wants it (test scope question — see §4).

---

## 3. Files I'll touch

| File | Change | Size |
|---|---|---|
| `shared/types.ts` | + `Notification.reason?`, + `Notification.suggestion?`, + `AuditAction: 'assignment_created' \| 'assignment_revoked'` | ~10 lines |
| `functions/src/http/assignAuthorityOfficers.ts` | Add `assignment_created` audit writes in the commit transaction | ~15 lines |
| `functions/src/http/unassignAuthorityOfficers.ts` | **New** function | ~120 lines |
| `functions/src/http/recordOfficerProposal.ts` | + `confirmedReview` gate | ~10 lines |
| `functions/src/http/authorityDecision.ts` | + `confirmedReview` gate (defensive) | ~5 lines |
| `functions/src/utils/notifications.ts` | + `reason` / `suggestion` params on `createNotification` | ~10 lines |
| `functions/src/index.ts` | Export `unassignAuthorityOfficers` | +1 line |
| `frontend/src/pages/admin/AdminAssignment.tsx` | + "Unassign" button(s) | ~40 lines |
| `frontend/src/pages/admin/AdminApplicationQueue.tsx` | + per-row "Assign" link | ~25 lines |
| `frontend/src/pages/authority/AuthorityEventReview.tsx` | + checkbox + state + reset | ~25 lines |
| `frontend/src/components/layout/NotificationBell.tsx` | + reason/suggestion rendering | ~15 lines |
| `frontend/tests/m3/officer-assignment.spec.ts` | Extend with `confirmedReview` + audit log + (optionally) unassign | ~50 lines |
| `frontend/tests/m3/m3-controls-notifications.spec.ts` | Extend with reason/suggestion assertions | ~30 lines |
| `frontend/tests/m3/unassign-officer.spec.ts` | **New** | ~80 lines |

**Total:** ~14 files, ~430 lines added. One new Cloud Function.

---

## 4. Test plan (28 → ~36 specs)

| Project | Before | After | Delta |
|---|---:|---:|---|
| m3-smoke | 12 | 12 | 0 (existing specs absorb the new gates) |
| m3-full | 14 | 14 | 0 |
| m3-workstream1 | 2 | 5 | +3 (unassign: single, all, refusal-after-proposal) |
| **Total** | **28** | **31** | **+3** |

I don't plan to add a spec for the queue link (UI-only, no logic). I'll manually verify it and screenshot it.

If you want more test coverage (e.g. queue link spec, FR-M3-16 checkbox defensive gate on the legacy `makeAuthorityDecision` path), say so — happy to add.

---

## 5. Cross-cutting concerns

- **Breaking change to `Notification` type?** No — adding optional fields is non-breaking. Old data without the fields keeps reading.
- **Test flake risk?** Unassign tests will sign in 4× (admin only for the 3 unassign cases). Should be well under the 180s timeout. Will run in `m3-workstream1` so the cumulative auth cost stays bounded.
- **Migration of existing notifications?** None. New notifications carry the fields; old ones don't. UI degrades gracefully.
- **Backward-compat for `recordOfficerProposal` without `confirmedReview`?** It defaults to `false` → rejection is refused but approval is also refused. So an unupdated caller would break. Mitigation: update the existing `officer-assignment.spec.ts` "full flow" to pass `confirmedReview: true` in the same commit.

---

## 6. Verification

1. `npx tsc --noEmit` on `functions/` and `frontend/` — zero errors.
2. `npx playwright test --project=m3-smoke` — 12/12.
3. `npx playwright test --project=m3-full` — 14/14.
4. `npx playwright test --project=m3-workstream1` — 5/5 (3 new + 2 existing).
5. Manual smoke: open `/admin/applications`, click "Assign" on a row, unassign an officer, re-assign; verify audit log.
6. Manual smoke: sign in as PDRM, open an event, try to approve without ticking → blocked. Tick → success.
7. Manual smoke: sign in as organizer, open the bell, see a rejected-application notification with `reason` and `suggestion` as separate lines.

---

## 7. Out of scope (this round)

- **#1 `makeInitialReviewDecision` + Manual Review path** — new workstream, own plan doc.
- **FCM push notifications** — same as the existing plan: deferred until configured.
- **Per-doc control UI polish (drag-reorder, mass-verify, etc.)** — separate UX round.
- **Workstreams 2–6** (Stage 1 upload, Stage 2 public, publish, M4 trigger) — separate rounds.

---

## 8. Commit plan (3 commits)

1. `feat(m3): Workstream 1 polish — unassign + audit log + checkbox + notification split + queue link`
   All 5 items in one commit so the diff is reviewable as a unit.
2. `test(m3): extend officer-assignment + m3-controls-notifications for the 5 polish items`
   Test updates in one commit.

Or split into 5 commits (one per item) if you prefer — say the word.

---

## 9. Decision needed from you

**Confirm scope: ship #2-#6 in one round, defer #1 to its own round?**

If yes, I'll start. If you want a different cut (e.g. only #3 + #4, or include #1), tell me and I'll re-plan.
