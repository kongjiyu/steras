# M3 — Workstream 2 Plan: Event Control List Model + AI Generation

**Date:** 2026-08-18
**Owner:** M3 teammate (Chia Yu Xin)
**Branch:** `anny_cont` (carried over — NOT merged to main until you signal)
**Goal:** Ship UC-13 (Edit Event Control List), UC-33 (Generate Proposed List), UC-34 (Display Stage 1 + 2 Requirements). Closes Workstream 2 from `M3_GAP_ANALYSIS.md` §3.

---

## 0. The locked decisions affecting this work

From `M3_INTEGRATION_CONTRACT.md` §0:

| # | Decision | Impact on Workstream 2 |
|---|---|---|
| Q1 | `verifyEventControl` → operate on `event_controls/{id}/stage1_docs/{id}` | Already shipped (`ab8b33d`). The new control list is the container for these Stage 1 docs. |
| Q2 | Admin pages live in `pages/admin/`, reuse `AdminLayout` | New `AdminControlListEditor` uses `AdminLayout`. |
| Q3 | "Use Previous" gate is dropped | Affects Workstream 3 (organizer upload), not Workstream 2. |
| Q4 | `PublicReport` type defined | Affects Workstream 6, not 2. |
| Q5 | M2 owns `proposeEventControlList`; M3 stub for now | **Already shipped (`bf79619`)** — `functions/src/http/proposeEventControlList.ts` is the hardcoded stub. Workstream 2 just calls it. |

---

## 1. What's already done (so I don't redo it)

- ✅ `EventControl` type with `stage1Requirements[]`, `stage2Requirement`, `controlItemVersion`, `label`, `publicConfirmCount` (shipped in `bf79619`).
- ✅ `ProposedControlItem` type (the shape `proposeEventControlList` returns).
- ✅ `proposeEventControlList` Cloud Function (M3 stub) — hardcoded 5-item list per required authority, in `functions/src/http/proposeEventControlList.ts`.
- ✅ Seed writes control items in `seedM3RoundN1.js` for `evt-001-kl-marathon` (4 controls × 3 Stage 1 docs each).
- ✅ `AdminLayout` shell + `AdminAssignment` page (Workstream 1, `44a7840`) — the new `AdminControlListEditor` reuses the layout and the "review application" context.

What's NOT done:
- ❌ No `generateEventControlList` Cloud Function (the integration point that the admin UI calls).
- ❌ No `editEventControlList` Cloud Function (the commit point).
- ❌ No `onEventApproved` Firestore trigger (the auto-generation entry point).
- ❌ No `AdminControlListEditor` admin page.
- ❌ No `OrganizerEventControls` organizer page (UC-34 read-only view).
- ❌ No link from the admin review page to the editor.
- ❌ No tests for any of the above.

---

## 2. Recommended path

The work fits naturally into 5 small pieces, each shippable and reviewable:

| # | Piece | Cloud Function | Page | Trigger |
|---|---|---|---|---|
| 1 | Commit a list (foundation) | `editEventControlList` | — | — |
| 2 | Generate the proposal | `generateEventControlList` | — | — |
| 3 | Admin editor UI | — | `AdminControlListEditor` | — |
| 4 | Auto-generate on approval | — | — | `onEventApproved` |
| 5 | Organizer read-only view | — | `OrganizerEventControls` | — |

Order them by dependency. Pieces 1+2 are the Cloud Function surface; piece 3 is the admin UI on top; piece 4 is the auto-trigger; piece 5 is the organizer view (simplest, no mutations). Test as we go.

### Piece 1 — `editEventControlList` (commit point)

**Path:** `functions/src/http/editEventControlList.ts` (new).

**Signature:**
```ts
editEventControlList: httpsCallable<{
  eventId: string;
  items: ProposedControlItem[]; // the final list (after admin edits)
  controlItemVersion?: number;  // default 1
}, { written: number; controlIds: string[] }>
```

**Behaviour:**
- Admin only.
- Event must be in `status: 'Approved'` (post-second-review) or `'UnderReview'` (mid-flow). Refuse otherwise.
- Refuses if `event.controlListGenerated === true` and the version didn't bump — i.e. you can edit an existing list but you have to bump `controlItemVersion` to do so. (This prevents accidental overwrites when admin and trigger race.)
- Transaction: for each item, write `event_controls/{controlId}` with the agreed shape. Wipe the per-control Stage 1 docs first (they'll be re-seeded by Workstream 3 / by the organizer's initial upload).
- Set `event.controlListGenerated = true` (new field on EventRecord).
- Audit log: `control_list_published` (new `AuditAction` value) with the admin's UID, item count, and the list of `controlId`s.
- Notification to the admin: "Control list published for [event name]." (so the admin has a record of having done it).

**Test:** m3-full — 1 spec for "edit commits the list; idempotent on re-run; refuses non-admin / non-approved events".

### Piece 2 — `generateEventControlList` (proposal entry point)

**Path:** `functions/src/http/generateEventControlList.ts` (new).

**Signature:**
```ts
generateEventControlList: httpsCallable<{
  eventId: string;
  versionId?: string;  // default to event.currentVersionId
}, { items: ProposedControlItem[]; cached: boolean }>
```

**Behaviour:**
- Admin only.
- Event must be in `status: 'Approved'`.
- Calls the existing `proposeEventControlList` stub (or M2's real version when it lands).
- If the event already has `control_list_generated: true`, return the cached list from Firestore (don't call MiniMax again — A23: "don't regenerate without explicit reason").
- Returns `{ items, cached: true | false }`.

**Test:** m3-full — 1 spec for "first call hits the stub; second call returns the cache without calling the stub".

### Piece 3 — `AdminControlListEditor` (admin UI)

**Path:** `frontend/src/pages/admin/AdminControlListEditor.tsx` (new).

**Route:** `/admin/applications/:id/controls` (extends the existing admin app routes).

**Layout:**
- Header: event name, status pill, current `controlListGenerated` state.
- **If `!controlListGenerated`:** show a "Generate proposal" button (calls `generateEventControlList`). After click, the proposal populates the table.
- **If `controlListGenerated`:** show the existing list in a table (controlName, authority, Stage 1 reqs count, Stage 2 label, status badge). Each row has an "Edit" button → opens an inline editor (add/remove Stage 1 requirements; edit controlName).
- Bottom-right: "Commit changes" button (calls `editEventControlList` with the full updated list).
- Audit timeline: which admin published this list, when.

**Behaviour:**
- After a successful "Generate" call, the table auto-populates.
- After a successful "Commit changes" call, the table re-reads from Firestore.
- The "Commit changes" button is disabled if no changes have been made since the last commit (compares to a local snapshot).

**Test:** m3-full — 1 spec for "admin generates proposal → table populates → admin edits → commit → re-reads with new state". Uses `evt-002-pj-food-fair` (we set its status to `Approved` in `resetFoodFair` first).

### Piece 4 — `onEventApproved` trigger (auto-generate on second-review confirm)

**Path:** `functions/src/triggers/onEventApproved.ts` (new). Registered in `index.ts`.

**Behaviour:**
- Firestore trigger on `events/{id}.update`.
- Only acts when `event.status` moves to `'Approved'` AND `event.control_list_generated !== true` (idempotent).
- Calls `editEventControlList` server-side with the result of `proposeEventControlList`.
- Notification to the admin: "Control list auto-generated for [event name] — review at /admin/applications/[id]/controls."

**Test:** m3-smoke — 1 spec for "approve event → control list auto-generated → admin sees the proposed list in AdminControlListEditor".

**Caution:** the trigger must be server-only. Use the Admin SDK in the function. Don't expose this as a callable.

### Piece 5 — `OrganizerEventControls` (organizer read-only view)

**Path:** `frontend/src/pages/organizer/OrganizerEventControls.tsx` (new).

**Route:** `/organizer/events/:id/controls`.

**Layout:**
- Header: event name, status.
- For each control: a card with controlName, authority badge, the Stage 1 requirements list (docType, label, required/optional), the Stage 2 requirement.
- "No controls yet" empty state if `event.control_list_generated !== true`, with a link back to the event detail page.

**Behaviour:**
- Read-only. No mutations. This is the UC-34 "Display Stage 1 and Stage 2 Requirements" surface.
- Use the same `AdminLayout`? No — this is an organizer page, so it uses the existing `WorkspaceTopBar` (or a new `OrganizerLayout` if you want). The existing event detail page uses `WorkspaceTopBar`; let me follow that.

**Test:** m3-smoke — 1 spec for "organizer sees the control list for an event with a generated list; sees the empty state for an event without one".

---

## 3. Trade-offs

- **Single page vs. multi-page editor?** I went with single page. The list is small (5 items max) and the editing surface is straightforward. Splitting it into a "view" + "edit" pair would add a navigation step for no real benefit.
- **Auto-generate on approval vs. admin must click?** The integration contract says "kicks off generateEventControlList for the admin to review". I read that as: auto-generate, then admin reviews. If you prefer admin-only (no auto), the trigger becomes a 3-line stub that just sets `control_list_generated: false` until the admin clicks. Easy switch later.
- **Re-call `proposeEventControlList` on every edit?** No — we cache the result. The admin's edits are local until commit, then the list is stored verbatim. This avoids the AI call being non-idempotent.
- **M2 stub vs. real call?** Use the stub. The contract is clear: M2 owns the real one, M3 calls it. The stub is already deployed and returns a hardcoded 5-item list that matches the seed.

---

## 4. Boundaries and assumptions

- **M2 dependency:** assume the stub stays. If M2 ships the real `proposeEventControlList` while this round is in progress, swap the import. Otherwise the stub is fine for prototype.
- **M1 dependency:** none. We only read `event.requiredAuthorities` + `event.currentVersionId`, both already written.
- **No Stage 1 docs yet:** Workstream 2 just creates the container. The organizer's upload UI (Workstream 3) is what fills the per-doc slots. Don't try to also do Stage 1 upload in this round.
- **No Stage 2 docs yet:** same.
- **Resubmission flow:** when a new version is approved (FR-M3-19 amendment), the old control list is archived (read-only, kept for audit) and a new one is created. For this round, we just append `.v{n}` to the controlId namespace so old and new can coexist. Workstream 3 can handle the UI for "this is the new version, the old is read-only".

---

## 5. Files I'll touch

| File | Change | Size |
|---|---|---|
| `functions/src/http/generateEventControlList.ts` | NEW | ~80 lines |
| `functions/src/http/editEventControlList.ts` | NEW | ~120 lines |
| `functions/src/triggers/onEventApproved.ts` | NEW | ~60 lines |
| `functions/src/index.ts` | Export the 2 new functions + 1 trigger | +3 lines |
| `shared/types.ts` | Add `AuditAction: 'control_list_published'`; add `EventRecord.control_list_generated?: boolean` | ~5 lines |
| `frontend/src/pages/admin/AdminControlListEditor.tsx` | NEW | ~300 lines |
| `frontend/src/pages/organizer/OrganizerEventControls.tsx` | NEW | ~150 lines |
| `frontend/src/App.tsx` | Add 2 new routes | +2 lines |
| `frontend/src/pages/admin/AdminApplicationReview.tsx` | Add a link to `AdminControlListEditor` | ~10 lines |
| `functions/src/utils/notifications.ts` | Add `'control_list_published'` to `NotificationType` (or use a new one); already supports arbitrary types | ~5 lines |
| `tests/m3/generate-control-list.spec.ts` | NEW (3 specs) | ~250 lines |
| `tests/m3/organizer-event-controls.spec.ts` | NEW (1 spec) | ~80 lines |
| `tests/m3/global-setup.ts` | Seed `evt-001-kl-music-festival` (already approved) for the "auto-generate on approval" test | ~20 lines |
| `tests/m3/admin-reset.ts` | New `resetApprovedEvent()` helper | ~30 lines |

**Total:** 14 files, ~1,100 lines. Largest single piece is the `AdminControlListEditor` page (300 lines) — most of it is the editable table UI.

---

## 6. Test plan — 4 new specs, 32 → ~36 specs

| Project | Before | After | New spec |
|---|---:|---:|---|
| m3-smoke | 13 | 14 | `onEventApproved` auto-generates the list, `OrganizerEventControls` shows the list |
| m3-full | 15 | 18 | `generate-control-list.spec.ts` (3 specs: generate, edit + commit, cache on re-call) |
| m3-workstream1 | 7 | 7 | — |

**New test file: `generate-control-list.spec.ts`** (m3-full):
1. "admin generates a proposal for an Approved event; the proposed items match the stub's hardcoded list".
2. "admin commits the list; event_controls/{id} docs are written; `event.control_list_generated = true`; audit log entry written".
3. "second call to generate returns the cached list without calling proposeEventControlList again" (test the `cached: true` flag).

**New test file: `organizer-event-controls.spec.ts`** (m3-smoke):
1. "organizer sees the read-only control list for an event with `control_list_generated = true`; sees the empty state for an event without it".

**New test in m3-smoke** (in a new file or existing):
1. "approve event via the second review → control list auto-generated → admin sees the proposed list in `AdminControlListEditor`".

Plus 2-3 small updates to existing files (route additions, link additions).

---

## 7. Verification

1. `npx tsc --noEmit` on `functions/` and `frontend/` — zero new errors.
2. `npm run build` on both — clean.
3. `firebase deploy --only functions:generateEventControlList,functions:editEventControlList,functions:onEventApproved` — successful.
4. `npx vite build && firebase deploy --only hosting` — successful.
5. `npx playwright test --project=m3-smoke` — 14/14.
6. `npx playwright test --project=m3-full` — 18/18.
7. `npx playwright test --project=m3-workstream1` — 7/7.
8. Manual smoke: approve an event as admin → see the control list auto-generated → open `AdminControlListEditor` → edit → commit → see the updated list.

---

## 8. Out of scope (deferred to Workstream 3 or later)

- **Stage 1 organizer upload UI** (Workstream 3, FR-M3-20, UC-28). This round just creates the container.
- **Stage 2 organizer upload UI** (Workstream 4, UC-35, etc.). Same.
- **"Use Previous" button** (Workstream 3, UC-29, FR-M3-26, A25/A26). Already decided (Q3) to drop the A26 gate.
- **AI-assisted rejection/revision wording** (FR-M3-05 second half).
- **M4 integration** (Workstream 6, FR-M3-30/31).
- **Admin publish to public** (Workstream 5, FR-M3-21).
- **`makeInitialReviewDecision`** (FR-M3-02..04) — already deferred to its own round.
- **Stage 1 doc sanitisation for public view** (Workstream 5, FR-M3-21, UC-15).

---

## 9. Commit plan — 3 commits (impl, tests, docs)

1. `feat(m3): Workstream 2 - event control list model + AI generation`
   All Cloud Functions + types + admin page + organizer page + trigger + routes.
2. `test(m3): extend specs for Workstream 2`
   4 new specs + admin-reset + global-setup updates.
3. `docs(m3): reflect Workstream 2 shipped`
   Update M3_INTEGRATION_CONTRACT + M3_REVIEW + M3_GAP_ANALYSIS.

Or split into 5 commits (one per piece) if you prefer — say the word.

---

## 10. Decision needed from you

1. **Scope: ship Workstream 2 (UC-13, UC-33, UC-34) in this round?** Approve, and I'll start.
2. **Auto-generate on approval: yes (default) or admin must click?** Default = yes. Switch is a 3-line stub.
3. **Commit granularity: 3 commits (impl, tests, docs) or 5 (one per piece)?** Default = 3.
4. **Anything missing or wrong in §2's per-piece behaviour?** If you want a different UX for `AdminControlListEditor` (e.g. add a per-control "regenerate this one" button), call it out.

Once you sign off, I'll start with piece 1 (`editEventControlList`) as the foundation, then build up. I'll follow the same /plan-mode discipline: foundation first, then expand, typecheck + deploy at checkpoints.
