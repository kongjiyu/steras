# M3 — Workstream 3 plan: organizer Stage 1 upload + "Use Previous"

**Date:** 2026-08-19
**Owner:** M3 teammate (Chia Yu Xin)
**Status:** Awaiting your sign-off on the 5 decisions in §6 before I start
**Branch:** `anny_cont` (latest: `8d324a9`)

This plan covers UC-28 (organiser uploads Stage 1 documents), UC-29 (organiser reuses a prior receipt via "Use Previous"), FR-M3-20, FR-M3-25 (upload half), and FR-M3-26. The view half of FR-M3-25 is already shipped (Workstream 2's `OrganizerEventControls`). The verification side (FR-M3-22, -23) is already shipped (Q1 refactor's `verifyStage1Doc`).

**What I am NOT touching:** Stage 2 (Workstream 4), public confirm/report (Workstream 4), admin publish (Workstream 5), M4 outcome trigger (Workstream 6), `makeInitialReviewDecision` (its own round).

---

## 1. What's already there (the foundation)

Workstream 2 + Q1 refactor + Workstream 1 polish give us a complete container + verification path. Workstream 3 fills the missing middle: the organizer's "I have the receipt, here it is" step.

| Already shipped | Path | Notes |
|---|---|---|
| `Stage1Doc` type | `shared/types.ts` | `status: 'pending_submission' \| 'pending_verification' \| 'verified' \| 'rejected' \| 'use_previous'`. The `'pending_submission'` status already exists in the union — it just has no writer today. |
| `EventControl.stage1Requirements` | `shared/types.ts` + `editEventControlList` | The template the admin committed (per-docType + label + required). |
| `event_controls/{controlId}/stage1_docs/{docId}` sub-collection | `verifyStage1Doc` reads/writes | Exists for verified docs. Workstream 3 writes the `pending_*` docs into the same sub-collection. |
| `OrganizerEventControls` (read-only) | `frontend/src/pages/organizer/OrganizerEventControls.tsx` | Already shows the empty-state message and the per-control cards. Needs the upload UI grafted in. |
| `evt-001-kl-music-festival` (Approved, all 5 authorities) | test fixture | The fixture already has the per-control `event_controls` + `stage1_docs/{docId}-s1-{docType}` docs seeded in `pending_verification` by `seedEventControls` in `global-setup.ts`. After Workstream 3, the test fixture needs to seed the docs in `pending_submission` instead (or `resetApprovedEvent()` cleans them + organizer uploads). |
| `verifyStage1Doc` (officer side) | `functions/src/http/verifyStage1Doc.ts` | Already handles all 5 doc statuses. Workstream 3 doesn't touch it. |
| `aggregateLabel()` | inside `verifyStage1Doc.ts` | `any rejected → resubmit_required; all verified/use_previous → approved; else pending`. Already correct for the upload paths. |

**No new types** are needed. The container + status enum + the per-control template are all in place. Workstream 3 is mostly: one Cloud Function + one UI pass + tests + docs.

---

## 2. The plan

### 2a. Cloud Function: `submitStage1Doc` (organizer-only)

**Signature:**
```ts
submitStage1Doc: httpsCallable<{
  eventId: string;
  controlId: string;
  docId: string;
  // Upload path (the common case):
  fileName?: string;
  mimeType?: string;       // 'image/jpeg' | 'image/png' | 'application/pdf'
  fileBase64?: string;     // raw base64 of the file bytes (no data: prefix)
  label?: string;          // optional human-readable; defaults to the requirement label
  // "Use Previous" path (the receipt shortcut, FR-M3-26, A25, A26 dropped):
  // M3 owner decision 2026-08-19: no source-event picker. Just a flag.
  usePrevious?: boolean;
}, {
  status: 'pending_verification' | 'use_previous';
  docId: string;
  controlId: string;
  // mirror for the UI to confirm what was written:
  uploadedAt: number;
}>
```

**Validation (server-side):**
- Caller is signed in + their `organizerId` (looked up via `resolveAuthUid`) matches the event's `organizerId`.
- `event.controlListGenerated === true` (no uploads to events that don't have a control list).
- `event_controls/{controlId}` exists and is for the current `versionId`.
- `docId` is in the control's `stage1Requirements` (the admin-defined template) — i.e. the organizer can't add new doc slots.
- If the existing doc has `status: 'verified'`, refuse (organizer can't re-upload after officer approved; must contact admin).
- If `usePrevious` is set: `docType` of the requirement must be `'receipt'` (A25). No source-event query — just marks the doc with `status: 'use_previous'`. The `usePreviousSourceEventId` field stays optional on the type for future use; Workstream 3 doesn't set it.
- If upload path: file size ≤ 700 KB binary (~940 KB base64 — under the 1 MB Firestore doc limit with headroom; see §6 Q1). MIME in `{image/jpeg, image/png, application/pdf}`. Per project convention: **base64 in Firestore, NOT Firebase Storage**.

**Writes (transaction):**
- Reads first: `eventRef`, `controlRef`, `docRef`.
- Writes the `stage1_docs/{docId}` doc with:
  - `status`: `'pending_verification'` (upload) or `'use_previous'` (Use Previous).
  - `uploadedAt`, `uploadedBy`.
  - `filePath`: `data:${mimeType};base64,${fileBase64}` for uploads; for `use_previous`, leave undefined.
  - `usePreviousSourceEventId`: only for `use_previous`.
  - If the previous status was `'rejected'`: clear `rejectionReason` + `rejectionSuggestion` (resubmit clears the rejection provenance).
  - If the previous status was `'use_previous'` and the organizer switches to an upload (or vice-versa): overwrite (rare but valid — the organizer changed their mind).
- `tx.update(controlRef, { updatedAt: now })` — no label change here (the per-doc status change already gets reflected by `verifyStage1Doc` on next verification call; or by a sibling `recomputeControlLabel` if I add one for upload paths).
- Actually, **yes I do want to recompute the label on submission** so the UI immediately shows "pending" instead of "pending_submission" once an upload lands. Tiny helper `aggregateLabel(docs)` already exists in `verifyStage1Doc.ts`; I'll extract it to `utils/controlAggregate.ts` for reuse.

**Audit log:**
- New `AuditAction: 'stage1_doc_submitted'` (in `shared/types.ts`).
- `audit_logs/{auditId}` with `id = ${versionId}_${controlId}_${docId}_submitted_${now}`, `actorId = caller uid`, `actorRole = 'organizer'`, `notes = label or usePrevious sourceEventId`, `metadata = { controlId, docId, docType, fileName?, fileSizeBytes?, usePreviousSourceEventId? }`.

**Notifications:**
- The assigned officer (from `events/{id}/assignments/{versionId}_{auth}`) gets `stage1_doc_submitted` notification: "PDRM has a Stage 1 doc awaiting your verification."
- The admin gets the same.
- New `NotificationType: 'stage1_doc_submitted'`.
- SourceActionId: `${eventId}_${controlId}_${docId}_${now}` (idempotency on retries).

**Idempotency:**
- Doc id is composite (the requirement's `docId`), so re-submission overwrites in place. Same `sourceActionId` on the notification = natural dedup.

**Refuses if:**
- Caller is not the organizer.
- Control is not for the current `versionId`.
- `usePrevious` on a non-receipt docType.
- File is too big / wrong mimeType.

### 2b. `aggregateLabel` extraction

Move `aggregateLabel(docs)` from `verifyStage1Doc.ts` to a shared helper, e.g. `functions/src/utils/controlAggregate.ts`. Both `verifyStage1Doc` and `submitStage1Doc` call it. The helper takes a `Stage1Doc[]` and returns the aggregate `EventControl['label']`. ~10 lines, no behaviour change.

### 2c. Firestore rules update

Current rules allow officer-side writes (via Cloud Functions only — but Firestore rules still gate client reads). For organizer reads: existing rules allow the organizer to read their own event's sub-collections (already in place for `decisions`, `audit_logs`). Need to add: `match /events/{eventId}/event_controls/{controlId}/stage1_docs/{docId}` — allow read if `request.auth.uid` is the event's organizer OR a provisioned officer for `control.authority` OR an admin. (Writes are server-only via Cloud Functions, so no client write permission needed.)

### 2d. Frontend: extend `OrganizerEventControls`

Currently read-only with "you'll be able to upload files here. (Workstream 3)" placeholder text. Convert to editable:

- Subscribe to `events/{id}/event_controls` + per-control `stage1_docs/*` (real-time via `onSnapshot`).
- For each control card, expand the body to show the `stage1Requirements` template:
  - For each requirement row: `[docType badge] [label] [status badge] [Upload | Use Previous | Replace | View]`.
  - Status states:
    - `pending_submission`: "Not uploaded yet" — show Upload + Use Previous (if receipt).
    - `pending_verification`: "Awaiting officer review" — show View (preview the file inline) + Replace.
    - `verified`: "Verified by [officer name] on [date]" — show View.
    - `rejected`: "Rejected: [reason]. Suggestion: [suggestion]." — show Resubmit + Use Previous (if receipt).
    - `use_previous`: "Reused from event [name]" — show View source + Switch to upload.
- File input component: `<input type="file" accept="image/jpeg,image/png,application/pdf">` with size guard. Show a small inline preview for images (uses the `data:` URL in `filePath`).
- "Use Previous" is a one-click button (no modal). On `docType: 'receipt'` slots only. Marks the doc as `use_previous` immediately. M3 owner decision 2026-08-19: no source-event picker — Stage 2 is the public verification backstop.
- "Stage 2 (visual evidence)" row stays read-only (Workstream 4 ships the upload).
- Header: counts of "X of Y Stage 1 docs verified" computed from the live sub-collection.

**Data flow:** the page subscribes to `event_controls/*` via `onSnapshot`; the per-control `stage1_docs/*` is a sub-subscription. On submit, call `submitStage1Doc`; Firestore push triggers a re-snapshot; the row updates without a page reload.

**New shared component: `Stage1RequirementRow.tsx`** — handles the 5 status states + the 4 button states. Reused later when the admin/officer UIs need to show the same row (probably Workstream 5 publish).

### 2e. Tests (Playwright)

New file: `frontend/tests/m3/organizer-stage1-upload.spec.ts` (m3-full, 4 specs):

1. **Organizer uploads a Stage 1 doc** — logs in as organizer, navigates to `/organizer/events/evt-001-kl-music-festival/controls`, picks the PDRM card → application letter slot, uploads a small JPEG (encoded as base64 in the test), submits, asserts the row now shows "Awaiting officer review" + the doc has `status: 'pending_verification'` + `filePath` starts with `data:image/jpeg;base64,` + audit log has `stage1_doc_submitted` + assigned PDRM officer got a `stage1_doc_submitted` notification.

2. **Organizer uses "Use Previous" on a receipt slot** — picks a receipt slot, clicks the "Use Previous" button, asserts `status: 'use_previous'` + `usePreviousSourceEventId` left unset + audit `notes` contains the rationale text. No prior event query in the test.

3. **"Use Previous" refuses on non-receipt** — picks the application letter slot, asserts the "Use Previous" button is NOT rendered (only Upload is).

4. **Resubmit after rejection** — rejects a doc via `verifyStage1Doc` (officer), then organizer re-uploads, asserts `status: 'pending_verification'` + `rejectionReason` cleared.

Plus a small update to `global-setup.ts`'s `seedEventControls` — for `evt-001` (and any other Approved fixture), the Stage 1 docs are seeded in `pending_submission` (instead of `pending_verification`) so the upload test has something to upload into. Tests that need `pending_verification` (existing `m3-controls-notifications.spec.ts`) call `resetApprovedEvent()` first to re-seed, or set the doc status via the API helper.

### 2f. Docs (1 commit)

Update in commit 3 (the docs commit):

- `M3_GAP_ANALYSIS.md`:
  - TL;DR counts: 23/3/14 → 25/3/12 (62% / 7% / 30%).
  - UC-28 ❌ → ✅, UC-29 ❌ → ✅.
  - FR table: FR-M3-20 ❌ → ✅, FR-M3-26 ❌ → ✅.
  - FR counts: 16/3/12 → 18/3/10.
  - Workstream 3 section: flip to SHIPPED.
- `M3_INTEGRATION_CONTRACT.md`:
  - §2: add `submitStage1Doc` row to the callable table; mark `uploadStage1Doc` (the older placeholder name) as renamed.
  - §3 NotificationType: add `'stage1_doc_submitted'`.
  - §3 AuditAction: add `'stage1_doc_submitted'`.
  - §6 (Q4): no change.
  - §7 (Q5): no change.
  - §10: add Workstream 3 row marked SHIPPED with file paths.
- `M3_REVIEW.md`:
  - Header: latest commit, 42/42 specs.
  - New section 5e: Workstream 3 — organizer Stage 1 upload + Use Previous.
  - §6 open items: remove the "Workstream 3 is NEXT" item (it's now done); renumber.

### 2g. 3-commit structure (per your default granularity)

- `feat(m3): Workstream 3 - organizer Stage 1 upload + Use Previous`
- `test(m3): Workstream 3 specs (4 organizer-stage1-upload)`
- `docs(m3): reflect Workstream 3 shipped`

---

## 3. Dependencies on other modules

- **M2 owner**: still owes the real `proposeEventControlList` (Q5). Workstream 3 doesn't care — we use whatever the AI / stub produced. The Stage 1 requirements template is already in `event_controls/{controlId}.stage1Requirements`.
- **M1 owner**: no new fields needed. `organizerId` is the only M1 field Workstream 3 reads.

---

## 4. Risks + mitigations

| Risk | Mitigation |
|---|---|
| 1 MB Firestore doc limit on the base64 file | Cap at 700 KB binary (~940 KB base64). PDFs are denser so 700 KB covers most receipts. Show a friendly error for larger files. |
| Resubmit after rejection breaks audit trail | Audit log writes a new entry per submit; previous rejection entry remains in `audit_logs` for history. |
| "Use Previous" without source event — no audit trail of "which prior event" | Acceptable per M3 owner decision 2026-08-19: Stage 2 is the public verification backstop. The audit `notes` records the rationale so the trail is in `audit_logs`. |
| Two organizers on the same event (shouldn't happen, but…) | `event.organizerId` is the only key; the function refuses if `callerOrganizerId !== event.organizerId`. |
| Cloud Function cold-start flake | Use the same try/catch + log pattern as `verifyStage1Doc` (`console.warn` for `HttpsError`, `console.error` for unknown). |
| File upload size in the Playwright test (encoding 700 KB in JSON) | Test uses a small synthetic JPEG (~5 KB) so the payload is tiny. |
| Existing tests that depend on `pending_verification` (m3-controls-notifications etc.) | Update `seedEventControls` to default to `pending_submission`; add a one-liner to set `pending_verification` where needed. Verify all 38 existing specs still pass. |

---

## 5. Verification

- All 38 existing specs still pass.
- 4 new specs pass: m3-full 17 → 21.
- Total: 42/42 specs across 3 projects (m3-smoke 14, m3-full 21, m3-workstream1 7).
- Manual smoke:
  1. Log in as `uat-organizer@steras.test`.
  2. Open `/organizer/events/evt-001-kl-music-festival/controls`.
  3. Each of the 5 authority cards shows N Stage 1 doc slots in "Not uploaded yet" state.
  4. Upload a JPEG to the PDRM application letter slot → row flips to "Awaiting officer review".
  5. Click "Use Previous" on a receipt slot → modal lists prior events → pick one → row flips to "Reused from event X".
  6. Log in as `uat-pdrm@steras.test` → bell shows "PDRM has a Stage 1 doc awaiting your verification".

---

## 6. Decisions I need from you

### Q1. File size cap (the 1 MB Firestore doc limit)

Per the project convention ("Base64 in Firestore, NOT Firebase Storage"), the file goes into the `stage1_docs/{docId}` doc as a data URL in `filePath`. Firestore docs are capped at 1,048,572 bytes. After the data-URL prefix (`data:image/jpeg;base64,` ≈ 22 chars) + JSON envelope (`{"filePath":"...","status":"...","uploadedAt":...}` ≈ 90 chars) + the per-doc metadata (label, docType, etc. ≈ 100 chars), the base64 payload has ~950 KB of room — which decodes to ~712 KB of binary.

**My pick: 700 KB binary cap.** Refuses larger files with "File too large; max 700 KB. Compress and re-upload." Accepts JPEG, PNG, and PDF.

- A: 700 KB cap (my pick — safe under the Firestore limit, covers most receipts).
- B: 500 KB cap (more headroom, but rejects most real receipts).
- C: Use Firebase Storage (breaks the project convention; needs new security rules + a download-URL flow).
- D: Split into chunks (more code, more writes; only worth it if you anticipate multi-MB files).

### Q2. "Use Previous" eligibility scope

**M3 owner decision (2026-08-19):** the "Use Previous" button is just a flag — no source-event picker. The organizer clicks it on a receipt slot to mark the doc as `use_previous` without uploading anything. No prior event query, no sourceEventId parameter, no modal. The rationale (which matches the dropped-A26 decision): **Stage 2 is the public verification backstop** — if the item isn't actually at the venue, the public sees the gap via Stage 2 and can report via M4. The "Use Previous" button is a UX shortcut (skip the upload), not a verification bypass.

**Implementation:** the button calls `submitStage1Doc({eventId, controlId, docId, usePrevious: true})`. The server validates `docType === 'receipt'`, then writes the doc with `status: 'use_previous'`. `usePreviousSourceEventId` stays optional on the type (for future use) but the Workstream 3 path doesn't set it. Audit `notes` records "Use Previous: organizer asserted item already procured; Stage 2 is the verification backstop."

### Q3. Notification targets on submit

The submit should notify someone. Options:

**My pick: notify the assigned officer + the admin.** Officers need to know they have work; admins oversee the whole review queue.

- A: Officer + admin (my pick).
- B: Officer only.
- C: Admin only.
- D: Nobody (just the row status changes; rely on the officer visiting the page).

### Q4. Resubmit after rejection — clear the prior rejection data?

If the organizer re-uploads after a `rejected` doc, the new `stage1_doc_submitted` audit entry is a fresh row, but the doc carries `rejectionReason` + `rejectionSuggestion` from the prior verification. Officers reading the doc on the next pass will see "previously rejected for X" — which is actually useful (officer knows the doc was flagged before and can re-check that specific issue).

**My pick: keep the rejection data on resubmit; the next `verifyStage1Doc` call will overwrite it.** Auditor can see the trail in `audit_logs`; officer can see the prior rejection reason on the doc.

- A: Keep prior rejection data on resubmit (my pick — preserves the trail on the doc itself; cleared on next verification).
- B: Clear prior rejection data on resubmit (cleaner doc, but the trail lives only in `audit_logs`).
- C: Move the prior rejection data to a sub-field `rejectionHistory[]` and append (heaviest; might be overkill).

### Q5. Should this round also include the "approve the doc + bump controlItemVersion on full verify" polish?

When a control's last Stage 1 doc gets verified, `verifyStage1Doc` already bumps the aggregate label to `approved` and adds to `event.verifiedControlIds`. But it does NOT bump `controlItemVersion`. The plan was that `controlItemVersion` bumps on resubmission (when a verified control gets a new rejection), not on the first approval. So no change needed.

**My pick: don't change `verifyStage1Doc`.** The `controlItemVersion` semantics stay: bumped when `editEventControlList` re-commits a new list (current `1` per round).

- A: Don't touch it (my pick).
- B: Also bump it on first all-verified (semantic change — needs doc update).
- C: Bump it on every rejection → re-verification cycle (also a semantic change).

---

## 7. Out of scope (explicitly deferred)

- **Stage 2 upload** (Workstream 4, UC-35..38). The "Stage 2 (visual evidence)" row in the UI stays read-only.
- **Public report / confirm** (Workstream 4).
- **Admin publish** (Workstream 5). The verified Stage 1 docs are still inside `event_controls/*`; they don't go to `public_event_controls` until Workstream 5.
- **M4 outcome trigger** (Workstream 6).
- **Initial review stage** (`makeInitialReviewDecision`, FR-M3-02..04). Its own round.
- **PDF / multi-page document preview**. The UI just shows a small image thumbnail for images and a "Download to view" link for PDFs.

---

**Bottom line:** 3 commits (impl / test / docs), one new Cloud Function, one UI pass on `OrganizerEventControls`, 4 new specs (42/42 total), and 5 small decisions above. Once you sign off on §6, I'll start.
