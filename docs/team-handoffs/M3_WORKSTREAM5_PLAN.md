# M3 — Workstream 5 plan: Admin publish + sanitisation gate (Stage 2)

> **Status update — 2026-08-21:** Implemented. The admin publish gate now
> writes `public_event_controls/{eventId}/items/{controlId}-stage2`, and the
> public page reads only that sanitised projection. Replacement uploads,
> unpublish/reject, withdrawal cleanup, and M4 outcomes remove or restore the
> projection atomically as appropriate. The original scope notes below are
> retained as design history.

**Date:** 2026-08-20
**Owner:** M3 teammate (Chia Yu Xin)
**Status:** Awaiting your sign-off on the 5 decisions in §6 before I start
**Branch:** `anny_cont` (latest: `3cea290` — Workstream 4 SHIPPED, 49/49 specs green)

This plan covers UC-14 (Publish Event Control Document to Public View) and UC-15 (Sanitise Event Control Document), both under FR-M3-21. It also tightens the WS4-loosened `stage2_docs` Firestore rule back to a per-doc `published == true` check now that we have a real admin publish gate.

**Why now:** WS4 added the upload + public confirm/report flow, but the `stage2_docs` rule had to be relaxed to `isSignedIn()` because (a) the original `isAdmin()`-on-every-read call created a circular `get()` evaluation and (b) the `resource.data.published` access throws on a collection-level subscription when the collection is empty. Both are fixed by adding an admin publish gate. WS5 is the smallest change that restores the original security posture.

**What I am NOT touching:** the `makeInitialReviewDecision` initial-review-stage work (its own round), the M4 outcome trigger (Workstream 6, blocked on M4), Stage 1 organizer flow (WS3, shipped), Stage 2 upload + confirm/report (WS4, shipped). Image cropping / PII-redaction is explicitly **out of scope** for WS5 — see Q2 below.

---

## 1. What's already there

| Already shipped | Path | Notes |
|---|---|---|
| `Stage2Doc` type | `shared/types.ts` | Already has `published, publishedAt?, publishedBy?`. The WS4 function sets all three on upload (auto-publish). WS5 changes this: upload → `published: false`; admin review flips it. |
| `events/{id}/event_controls/{controlId}/stage2_docs/{docId}` sub-collection | `firestore.rules` line 206–213 | Read currently `isSignedIn()` (WS4 relax). Writes server-only. WS5 tightens this. |
| `submitStage2Doc` Cloud Function | `functions/src/http/submitStage2Doc.ts` | WS4. Sets `published: true` on upload. WS5 changes to `published: false`. |
| `confirmStage2Doc` + `reportStage2Doc` | WS4 | No changes. They already gate on `stage2.published === true` (the function checks). After WS5, that check still works because the function is server-side and reads the doc after the admin publishes. |
| `Stage2RequirementRow` component | `frontend/src/components/stage2/Stage2RequirementRow.tsx` | 3 states: pending / published / reported (m4TicketId). WS5 adds a "rejected" state + reorganises the badges. |
| `PublicEventDetail` page | `frontend/src/pages/public/PublicEventDetail.tsx` | Already filters by `stage2Docs` presence. WS5 tightens to `published === true` only. |
| `AdminLayout` + `Sidebar` | WS2 | Has nav slots for /admin/applications, /admin/users, /admin/venues. WS5 adds a Stage 2 review entry (per-event, not a top-level page). |
| `__sterasFirebase.callable` helper | `frontend/src/config/firebase.ts` | Page-context API for calling Cloud Functions from tests. No change. |
| `public_event_controls/{eventId}/{controlId}/{stage}/{docId}` collection | `firestore.rules` line 264–270 | Read by anyone; writes server-only. **Defined but not used.** WS5 keeps this reserved for a future "sanitised copy" feature (out of scope this round). |

---

## 2. Target flow (post-WS5)

```
Organizer uploads Stage 2 image
        ↓
submitStage2Doc Cloud Function
        ↓ writes: stage2_docs/{docId} with published = false
        ↓ notifies: officer (FYI), admin (action required)
        ↓ audit:   stage2_doc_submitted
        ↓
OrganizerEventControls shows row with "Pending admin review" badge
        ↓
PublicEventDetail does NOT render the card (filter on published === true)
        ↓
Admin opens /admin/applications/{eventId}/stage2-review
        ↓ sees: per-authority cards with the image, "Publish" + "Reject" buttons
        ↓
Admin clicks "Publish"
        ↓ publishStage2Doc Cloud Function
        ↓ sets: published = true, publishedAt, publishedBy
        ↓ notifies: organizer ("Stage 2 image published")
        ↓ audit:   stage2_doc_published
        ↓
PublicEventDetail now renders the card (👍 / 🚩 buttons work)
        ↓
(Or) Admin clicks "Reject" with a reason
        ↓ unpublishStage2Doc Cloud Function
        ↓ sets: published = false, rejectionReason, rejectionAt, rejectedBy
        ↓ notifies: organizer ("Stage 2 image rejected — see reason")
        ↓ audit:   stage2_doc_rejected
        ↓
Organizer can re-upload (replaces the doc, resets to published = false, clears rejection fields)
```

---

## 3. Firestore rule tightening (the security fix)

**Current (WS4):**
```js
match /event_controls/{controlId}/stage2_docs/{docId} {
  allow read: if isSignedIn();
  allow write: if false;
}
```

**Target (WS5):**
```js
match /event_controls/{controlId}/stage2_docs/{docId} {
  // Collection subscription: always allow so the public page can
  // subscribe (resource.data is null for a collection, and we can't
  // gate on .published without throwing on an empty collection).
  // Per-document read: only published === true (the public sees the
  // sanitised view; the admin sees everything via the second clause).
  allow read: if isSignedIn() && (resource.data == null || resource.data.published == true);
  // Admin sees all (including pending + rejected).
  allow read: if isSignedIn() && isAdmin();
  allow write: if false; // server-only
}
```

Why this works (and why the prior two attempts didn't):

- **The collection-subscription problem.** `onSnapshot(collection(db, ..., stage2_docs))` evaluates the rule on the collection path. `resource.data` is `null` for a collection. Accessing `null.published` throws, killing the subscription. The `resource.data == null` short-circuit handles this.
- **The circular `get()` problem.** `isAdmin()` calls `get()` on `users/{uid}`. The user-doc read rule allows self-read (`request.auth.uid == userId`), so the `get()` returns the doc (or "not found" for missing profiles). It does NOT throw on a public user — it just returns the doc and we check `role == 'admin'` against it. So `isAdmin()` is safe to call in a `||` chain.
- **Two `allow read` clauses.** Firestore treats them as alternatives. If clause 1 allows → read. If clause 1 denies but clause 2 allows → read. If both deny → denied. The `||` inside clause 1 short-circuits at `resource.data == null` for collections and at `resource.data.published == true` for published docs, so we never reach the `.published` access on a null.

The organiser can still subscribe to their own event's `event_controls/{id}/stage2_docs/{id}` (the per-doc docId-suffixed path) and read it because they're a signed-in user, but only when the doc is `published: true`. That's the same visibility the public has — the organiser gets no special access to the pending doc via Firestore rules; they see their own pending state only through the `event` doc's denormalised snapshot (or by the fact that the `stage2_doc_submitted` notification was sent to them). If the organiser needs to see the pending image for the "Replace" flow, we add a third clause: `allow read: if isSignedIn() && isOwner(get(/databases/$(database)/documents/events/$(eventId)).data.organizerId);` — same pattern as `event_controls`. **Q4 below.**

---

## 4. New + changed code

### 4a. Cloud Functions (functions/src/http/)

| File | Change |
|---|---|
| `submitStage2Doc.ts` | Set `published: false` on upload (drop the auto-publish). Notify **admin** (not just officer — admin needs to act). Audit unchanged. |
| `publishStage2Doc.ts` | **NEW**. Admin-only. Sets `published: true`, `publishedAt`, `publishedBy`. Audit `stage2_doc_published`. Notify organizer. |
| `unpublishStage2Doc.ts` | **NEW**. Admin-only. Sets `published: false`, `rejectionReason?`, `rejectionAt?`, `rejectedBy?`. Audit `stage2_doc_rejected`. Notify organizer with the reason in the message. |
| `index.ts` | Export both new functions. |

### 4b. Shared types (shared/types.ts)

- `Stage2Doc`: add `rejectionReason?: string`, `rejectionAt?: number`, `rejectedBy?: string`.
- `AuditAction`: add `'stage2_doc_published' | 'stage2_doc_rejected'`.
- `NotificationType`: add `'stage2_doc_published' | 'stage2_doc_rejected'`.

### 4c. Firestore rules (firestore.rules)

- Replace the `stage2_docs` match block (see §3). One read clause with the null-safe published check, one read clause for admin.

### 4d. Frontend (frontend/src/)

| File | Change |
|---|---|
| `pages/admin/AdminStage2Review.tsx` | **NEW**. Per-event review page at `/admin/applications/{eventId}/stage2-review`. One card per control with the image (or "No image uploaded" placeholder) and Publish / Reject / Unpublish buttons. Reject opens a modal for the reason (optional but encouraged). |
| `components/stage2/Stage2RequirementRow.tsx` | Add a `rejected` state (red badge "Rejected — see reason" + the reason text + Replace button that calls `submitStage2Doc` with the new image). Rename current `pending` → "Pending admin review" for clarity. |
| `pages/organizer/OrganizerEventControls.tsx` | The row component already receives the doc; just needs the `rejected` branch. No structural change. |
| `pages/public/PublicEventDetail.tsx` | Filter `visibleControls` on `published === true` (was: presence-only). |
| `components/admin/Sidebar.tsx` | Add a "Stage 2 review" link under the event's admin context (or wire it from `AdminApplicationReview`'s "Open control list" → "Review Stage 2 images"). |
| `App.tsx` | Add route `/admin/applications/:eventId/stage2-review` → `<AdminStage2Review />`. |

### 4e. Tests (frontend/tests/m3/)

| File | Change |
|---|---|
| `stage2-admin-publish.spec.ts` | **NEW**. 4 specs: (1) admin publishes a pending image → row goes from `data-status="pending"` to `data-status="published"` in the organizer UI; (2) admin rejects with reason → row shows `data-status="rejected"` with the reason text; (3) admin unpublishes a published image → row goes back to `data-status="pending"`; (4) public viewer cannot see a rejected/pending image (the `data-testid="public-stage2-card-PDRM"` does not exist for them). |
| `stage2-organizer-upload.spec.ts` | Update step 5 — replace `expect data-status='published'` with `expect data-status='pending'`, then add `await loginAs('admin'); await page.goto('/admin/applications/{id}/stage2-review'); ... click Publish ...` then back to organizer to confirm `data-status='published'`. |
| `stage2-public-confirm-report.spec.ts` | Update `setupControlListAndUpload` helper to publish the image after uploading (so the public-page assertions still see it). The reporter test now exercises the full pipeline: organizer upload → admin publish → public confirm + report. |
| `organizer-event-controls.spec.ts` | No change — the WS2 spec doesn't touch Stage 2 image state. |
| `admin-reset.ts` | No change — `resetApprovedEvent` already wipes stage2_docs and the per-control sub-collections. |

### 4f. Docs

- `docs/team-handoffs/M3_WORKSTREAM5_PLAN.md` — this file.
- `docs/team-handoffs/M3_INTEGRATION_CONTRACT.md` — bump status line to "Workstream 5 SHIPPED".
- `docs/team-handoffs/M3_REVIEW.md` — §5e WS5 entry.
- `docs/team-handoffs/M3_GAP_ANALYSIS.md` — UC-14, UC-15 → ✅.

---

## 5. Verification bar

- `npx playwright test --project=m3-full` → 32/32 (was 28/28; +4 admin-publish specs; -2 modified organizer / public specs net to 0 since they grow not shrink).
- `npx playwright test --project=m3-smoke` → 14/14 (unchanged — the smoke project doesn't include the WS5-specific specs).
- `npx playwright test --project=m3-workstream1` → 7/7 (unchanged).
- Hand-check the deployed app: organizer uploads → admin sees pending card → admin clicks Publish → public page now shows the card. Same path with Reject → card disappears + organizer sees the reason.

---

## 6. Decisions to lock

### Q1 — Auto-publish vs explicit-publish (RECOMMENDED: **remove auto-publish, add admin gate**)

WS4 auto-publishes on upload. WS5 should require admin to click "Publish" before the image goes public. This is the only way to tighten the rule and the whole point of FR-M3-21. The trade-off: the public page won't show newly uploaded images until the admin reviews them (typically minutes to hours). For UAT, that's fine. For prod, we'd want an SLA + a queue.

### Q2 — Sanitisation scope (RECOMMENDED: **visual review only, no image replacement**)

WS5 admin sees the uploaded image and either Publishes (as-is) or Rejects (with a reason). **No image cropping, no PII redaction, no separate sanitised copy.** Reasoning: cropping requires a client-side canvas tool (significant UI work for a UAT demo), PII redaction is a stretch goal that's better handled by the public page choosing what fields to render, and the separate `public_event_controls/` collection already exists for when we want to add a sanitised copy later. If you want full sanitisation in WS5, the scope triples and I'd push to a WS5.5.

### Q3 — Migration of existing published images (RECOMMENDED: **leave as-is, no migration**)

The WS4 test runs already published ~6 images to `evt-001`. WS5 changes the rule to gate on `published: true`. Existing images still have `published: true` (the WS4 function set it on upload). So they remain public. No migration needed. The alternative — force a re-publish pass — adds operational burden with no security benefit (the images were already public).

### Q4 — Organizer read access to pending/rejected docs (RECOMMENDED: **add organizer-as-owner read clause**)

The organizer's "Replace" flow needs to see the current doc (for the rejection reason display and for confirming the existing image is the one being replaced). Add a third `allow read` clause:
```js
allow read: if isSignedIn() && isOwner(get(/databases/$(database)/documents/events/$(eventId)).data.organizerId);
```
Same `isOwner + get(event)` pattern that `event_controls` already uses. The organizer's own pending/rejected images are visible to them; nobody else's are.

### Q5 — Reject UX (RECOMMENDED: **optional reason, encouraged via placeholder**)

The reject modal has a textarea for the reason. It's optional (admin can publish-then-take-down via the Unpublish button if they change their mind). The organizer's notification includes the reason text. Mirrors the Stage 1 reject pattern (FR-M3-05 / FR-M3-08 split — but for WS5 we only need a single `reason` string; the suggestion split is Stage-1-only).

---

## 7. Out of scope (explicit)

- **Image cropping / PII redaction** (Q2) — push to WS5.5 or a security hardening round.
- **Bulk publish** — admin reviews one control at a time. Bulk is a "ship it faster" optimisation, not a correctness need.
- **M4 outcome trigger** (WS6) — blocked on M4 existing.
- **Image replacement by admin (sanitised version)** — same as Q2. The `public_event_controls/` collection is reserved for this; not wired up this round.
- **Officer direct read of `stage2_docs`** — the original WS5 design said "if the officer UI needs direct stage2_docs reads". The officer verifies Stage 1 (the documentation), not Stage 2 (the public photo). They use the `event_controls` metadata. No change.

---

## 8. Risk + mitigation

- **Risk:** Tightening the rule breaks the public page subscription. **Mitigation:** the `resource.data == null` short-circuit in §3 is exactly for this case. WS4 already proved the collection-subscription pattern works; WS5's rule is strictly more permissive at the collection level.
- **Risk:** The `isAdmin()` clause calls `get()` on the user doc, which is the same pattern that caused the WS4 circular-`get()` bug. **Mitigation:** the user-doc read rule allows self-read. `get()` on a public user's own doc succeeds and returns `role: 'public'`, so `isAdmin()` returns false. No throw, no circular. The second `allow read` clause is independent of the first, so even if the first throws, the second is still evaluated.
- **Risk:** The organizer's "Replace" flow is blocked if they can't read their own pending doc. **Mitigation:** Q4 adds the organizer-as-owner clause. If you decline Q4, the organizer can still re-upload blindly (the `submitStage2Doc` function reads the current doc server-side and refuses replace only if `m4TicketId` is set; for a rejected doc, replace is fine).
- **Risk:** The admin review queue has no notification. **Mitigation:** `submitStage2Doc` now notifies the admin (per Q1, change from "officer only" to "officer + admin"). The bell badge will show the count.

---

## 9. Commit plan

3 commits (impl / UI / docs), same granularity as WS2-WS4:

1. `feat(m3): Workstream 5 — admin publish/reject gate + rule tightening + types`
   - `submitStage2Doc.ts` (drop auto-publish, notify admin)
   - `publishStage2Doc.ts` (new)
   - `unpublishStage2Doc.ts` (new)
   - `index.ts` (exports)
   - `shared/types.ts` (new audit + notification + Stage2Doc fields)
   - `firestore.rules` (rule tightening)

2. `feat(m3): Workstream 5 UI — AdminStage2Review page + Stage2RequirementRow rejected state + PublicEventDetail filter`
   - `pages/admin/AdminStage2Review.tsx` (new)
   - `components/stage2/Stage2RequirementRow.tsx` (rejected state)
   - `pages/public/PublicEventDetail.tsx` (published-only filter)
   - `pages/organizer/OrganizerEventControls.tsx` (no change — row handles it)
   - `components/admin/Sidebar.tsx` (nav link)
   - `App.tsx` (route)

3. `test(m3): Workstream 5 specs (4 admin publish) + updates to existing stage2 specs`
   - `stage2-admin-publish.spec.ts` (new, 4 specs)
   - `stage2-organizer-upload.spec.ts` (updated)
   - `stage2-public-confirm-report.spec.ts` (updated)
   - `playwright.config.ts` (add to m3-full)

4. `docs(m3): reflect Workstream 5 shipped`
   - `M3_INTEGRATION_CONTRACT.md` (status)
   - `M3_REVIEW.md` (§5e)
   - `M3_GAP_ANALYSIS.md` (UC-14, UC-15 → ✅)

Not merged to main until you signal (per the standing rule).

---

## 10. Post-WS5 outlook

- **WS5.5 (optional):** image cropping / PII redaction client-side tool, writing a sanitised copy to `public_event_controls/`. Triggered by your call.
- **WS6 (blocked on M4):** public_reports outcome trigger → auto-update Stage 2 doc label + admin notification.
- **Security hardening (separate round):** review the `isSignedIn()`-only `event_controls` and `assignments` rules, decide if they need similar tightening once the public listing goes live.
