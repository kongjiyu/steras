# M3 — Workstream 4 plan: Stage 2 organizer upload + public confirm/report

**Date:** 2026-08-19
**Owner:** M3 teammate (Chia Yu Xin)
**Status:** Awaiting your sign-off on the 4 decisions in §6 before I start
**Branch:** `anny_cont` (latest: `09a6afe`)

This plan covers UC-35 (public confirm Stage 2 image), UC-36 (public report Stage 2 image), UC-37 (display + increment confirmation count), UC-38 (direct report to M4 / holding), and FR-M3-27, FR-M3-28, FR-M3-29. The "outcome" half of FR-M3-29 (M4's response) is Workstream 6, blocked on M4 itself.

**What I am NOT touching:** the `makeInitialReviewDecision` initial-review-stage work (its own round), admin publish / sanitisation (Workstream 5), M4 outcome trigger (Workstream 6), Stage 1 organizer flow (Workstream 3, already shipped).

---

## 1. What's already there

Workstream 2 (control list) + Workstream 3 (Stage 1 upload) give us the container + the verification pattern. Workstream 4 fills the visual-evidence surface: organizer's Stage 2 image upload, plus the public 👍/🚩 flow.

| Already shipped | Path | Notes |
|---|---|---|
| `Stage2Doc` type | `shared/types.ts` | `imageUrl, uploadedAt, uploadedBy, publicConfirmCount, reportedAt?, m4TicketId?, published, publishedAt?, publishedBy?`. The `published` + `m4TicketId` + `publicConfirmCount` fields already exist on the type — no new fields needed. |
| `events/{id}/event_controls/{controlId}/stage2_docs/{docId}` sub-collection | `firestore.rules` line 206–213 | Read scoped to admin, assigned authority, event owner (organizer). Writes server-only. |
| `public_reports/{ticketId}` collection | `firestore.rules` line 245–255 | Read scoped to reporter, admin, assigned authority, event owner. Client `create` allowed for any signed-in user. **Used as the M3 → M4 handoff target** (M3 writes; M4 updates `outcome`; M3 listens via Workstream 6). |
| `public_event_controls/{eventId}/{controlId}/{stage}/{docId}` collection | `firestore.rules` line 233–238 | Read by anyone (public). Writes server-only. **Workstream 5** writes here. WS4 doesn't need it. |
| `OrganizerEventControls` Stage 2 placeholder | Workstream 3 | Currently shows "Publicly verifiable — upload comes in Workstream 4." + the `data-testid="organizer-stage2-{authority}"` row. Needs the upload UI grafted in. |
| `PublicEventDetail` page | `frontend/src/pages/public/PublicEventDetail.tsx` | Reads from `public_events/{eventId}`. Shows event metadata. Doesn't render the per-control Stage 2 list yet — that's WS4. |
| `Stage1RequirementRow` | `frontend/src/components/stage1/Stage1RequirementRow.tsx` | **Pattern to mirror** for the organizer's Stage 2 row (similar 5-status / 4-button shape). |
| A30 rate-limit policy | assumption | "1 report per user per control" — applies to Stage 2 reports, not confirms. (Confirms could be more lenient — the user said earlier "no source-event picker for Use Previous"; the spirit is "trust the public, rate-limit by exception".) |
| `__sterasFirebase.callable` helper | `frontend/src/config/firebase.ts` | The page-context API for calling Cloud Functions from tests. |

**No new types** are needed. The container + status enums + the public report shape are all in place. Workstream 4 is: 3 Cloud Functions + 1 organizer UI + 1 public UI extension + 1 Firestore rules change + tests + docs.

---

## 2. The plan

### 2a. Cloud Function: `submitStage2Doc` (organizer-only)

**Signature:**
```ts
submitStage2Doc: httpsCallable<{
  eventId: string;
  controlId: string;
  // Single image per control. docId is implicit: `${controlId}-s2`.
  // Re-upload overwrites the existing Stage 2 doc (rare but valid).
  fileName: string;
  mimeType: string;       // 'image/jpeg' | 'image/png'  (Stage 2 = photo evidence, no PDF)
  fileBase64: string;     // raw base64 (no data: prefix)
  label?: string;         // optional caption
}, {
  status: 'published';    // WS4 auto-publishes on upload (the organizer is the source of truth)
  docId: string;
  controlId: string;
  uploadedAt: number;
}>
```

**Validation:**
- Caller is signed in + is the event's organizer (same pattern as `submitStage1Doc`).
- `event.controlListGenerated === true`.
- The control exists for the current `versionId` + has a `stage2Requirement` (i.e. `stageRequirement === 'stage1_and_stage2'`).
- File size ≤ 700 KB binary (same cap as Stage 1).
- MIME in `{image/jpeg, image/png}`. **No PDFs for Stage 2** — it's visual evidence of items actually at the venue, so a photo is the right shape.

**Writes (transaction):**
- Reads: event, control, existing Stage 2 doc (if any).
- Writes the `stage2_docs/{controlId}-s2` doc with:
  - `imageUrl`: `data:${mimeType};base64,${fileBase64}`.
  - `uploadedAt`, `uploadedBy`.
  - `published: true`, `publishedAt: now`, `publishedBy: uid` (WS4 auto-publishes; the organizer is the source of truth).
  - `publicConfirmCount: 0` (fresh on a re-upload; existing confirm counters belong to the prior image, not the new one).
  - Preserves `m4TicketId` from the prior doc if it exists (so M4's response to the prior ticket still tracks the same control; the new image is a "resubmitted" version).
- Recompute the parent control's aggregate label via `aggregateLabel()`. (The Stage 2 doc doesn't change the per-doc Stage 1 aggregate, so the label only changes if a `publicConfirmCount` threshold is crossed — see §2c for the rule. **Actually, by locked assumption A22, public confirmations are advisory only — they don't flip `label`. The label stays as whatever the per-doc Stage 1 verification computed.**)
- Writes a `stage2_doc_submitted` audit log entry (re-use the existing audit action; just actor=`organizer`, `metadata.path='stage2_upload'`).
- Notifies the assigned officer + admin: "Stage 2 image submitted — awaiting public verification."

**Idempotency:** the docId is `${controlId}-s2` (singleton per control). Re-upload overwrites.

### 2b. Cloud Function: `confirmStage2Doc` (any signed-in public viewer)

**Signature:**
```ts
confirmStage2Doc: httpsCallable<{
  eventId: string;
  controlId: string;
}, {
  alreadyConfirmed: boolean;   // true on idempotent re-calls
  publicConfirmCount: number;  // the new count
}>
```

**Validation:**
- Caller is signed in.
- The Stage 2 doc exists with `published === true`.
- **No rate limit on confirms** (A30 only applies to reports). One user can confirm once per control — but unlike reports, this is a soft limit, not a hard one. See §6 Q1.

**Writes (transaction):**
- Reads: the Stage 2 doc, the caller's confirm counter doc at `events/{id}/event_controls/{controlId}/stage2_confirms/{uid}`.
- If the counter doc exists: return `{ alreadyConfirmed: true, publicConfirmCount: <current> }` (no-op).
- Else: write the counter doc (marking the user as confirmed) + increment `publicConfirmCount` on the Stage 2 doc.

**Audit log:** a `stage2_confirmed` entry per first-time confirm. Volume might be high — see §6 Q2 (rate-limit, sampling).

**No notification** on confirm (low signal; just a counter increment).

### 2c. Cloud Function: `reportStage2Doc` (any signed-in public viewer)

**Signature:**
```ts
reportStage2Doc: httpsCallable<{
  eventId: string;
  controlId: string;
  category: 'item_not_at_venue' | 'wrong_venue' | 'low_quality_image' | 'other';
  description: string;       // 20–500 chars
  evidencePaths?: string[];  // optional URLs the reporter wants to add
}, {
  ticketId: string;           // public_reports/{ticketId} doc id
  alreadyReported: boolean;   // true on idempotent re-calls (A30)
  reportedAt: number;
}>
```

**Validation:**
- Caller is signed in.
- The Stage 2 doc exists with `published === true`.
- `description` length 20–500 chars.
- Rate limit: **1 report per user per control** (A30). Use a counter sub-collection `events/{id}/event_controls/{controlId}/stage2_reports/{uid}`. If the counter doc exists, return `{ alreadyReported: true, ticketId: <existing>, reportedAt: <existing> }`.

**Writes (transaction):**
- Reads: the Stage 2 doc, the caller's report counter doc (if exists), all sibling report counter docs (to ensure no race condition).
- Creates `public_reports/{ticketId}` doc with: `eventId, controlId, docId: '${controlId}-s2', reporterUid, category, description, evidencePaths?, outcome: 'under_review', createdAt, updatedAt`. The doc id is `${eventId}_${controlId}_${uid}_${now}` (composite; idempotent on retries within the same `now` window).
- Sets `reportedAt` + `m4TicketId: ticketId` on the Stage 2 doc.
- Writes the rate-limit counter doc.

**Audit log:** a `stage2_reported` entry with `actorRole: 'public'`, `metadata: { category, controlId, ticketId, m4TicketId }`.

**Notifications:**
- New `NotificationType: 'stage2_reported'`.
- Recipients: the assigned officer + the admin + the event organizer (3 notifications, one each).
- SourceActionId: `public_reports/{ticketId}` (the doc id is the natural idempotency key).

### 2d. `aggregateLabel` is unchanged

The aggregate label for an EventControl is computed from its Stage 1 docs only (per the locked design). Stage 2 confirmations are advisory; the `confirmed` count is a public-display metric, not a label. **No change to `aggregateLabel()` from Workstream 3.**

### 2e. Firestore rules update

Current rules for `events/{id}/event_controls/{controlId}/stage2_docs/{docId}`:
```rules
allow read: if isAdmin()
            || (isSignedIn() && isAssignedAuthority(eventId))
            || (isSignedIn() && isOwner(get(/databases/$(database)/documents/events/$(eventId)).data.organizerId));
allow write: if false; // server-only
```

WS4 adds:
```rules
// Public viewers can see Stage 2 images that the admin/organiser has published.
allow read: if isAdmin()
            || (isSignedIn() && isAssignedAuthority(eventId))
            || (isSignedIn() && isOwner(get(...).data.organizerId))
            || (isSignedIn() && resource.data.published == true);
```

(I.e. any signed-in user can read a published Stage 2 doc. The `published == true` gate means WS5's sanitisation step (unpublish + republish) actually hides the image during the gap.)

New rate-limit sub-collections:
```rules
// Per-user confirm + report counters (server-only writes).
match /stage2_confirms/{userId} { allow read: if isSignedIn(); allow write: if false; }
match /stage2_reports/{userId}  { allow read: if isSignedIn(); allow write: if false; }
```

### 2f. Frontend: extend `OrganizerEventControls` Stage 2 row

The placeholder at `data-testid="organizer-stage2-{authority}"` becomes a `Stage2RequirementRow`-shaped component with 3 states:

| State | UI |
|---|---|
| `pending` (no doc yet) | "Not uploaded yet" + Upload button (JPEG/PNG, 700 KB cap) |
| `published` (doc exists, `published: true`) | Image preview (data: URL) + current `publicConfirmCount` + `m4TicketId` badge if reported + Replace button |
| `reported` (sub-state of `published` when `m4TicketId` is set) | Same as `published` + a red "Reported to M4" badge with the ticketId. Organizer can't replace once reported (must wait for M4 outcome). |

I'll add a new component `frontend/src/components/stage2/Stage2RequirementRow.tsx` to keep the file size manageable. It mirrors the Stage 1 row's file picker + size guard pattern.

### 2g. Frontend: extend `PublicEventDetail` (the public viewer)

Current page: shows event metadata + a "Approved by" sidebar. **WS4 adds:** a "Verified controls" section below the metadata with one card per required authority.

For each control card:
- Authority badge (PDRM, BOMBA, …).
- Control name (e.g. "PDRM presence + traffic management").
- Stage 2 image (if `published: true`).
- Current `publicConfirmCount` + "X confirms".
- 👍 "I confirm" button (signed-in users; toggles to a disabled "You confirmed" state if the user has already confirmed).
- 🚩 "Report" button (opens a small modal: category dropdown + description textarea + "Submit report" button; shows a disabled "You reported" state if already reported).
- "Reported to M4" badge if a report exists (no M4 response UI yet — WS6).

The page subscribes to the per-event `event_controls/*` sub-collection + per-control `stage2_docs/*` + the per-control rate-limit counters. For the public viewer, the page uses the auth state to decide whether to show the confirm/report buttons.

**Empty states:**
- No controls published yet (admin hasn't run Workstream 2 + Workstream 5 publish): "No verified controls yet for this event."
- All controls published but no Stage 2 images: "Organiser hasn't uploaded Stage 2 images yet."

### 2h. Counter sub-collections display

The `publicConfirmCount` on the Stage 2 doc is the canonical count. The per-user counter sub-collection is for the rate-limit check only. No need to query the per-user counter from the client for the count display.

### 2i. Tests (Playwright)

Two new spec files (m3-full, ~6 specs):

**`stage2-organizer-upload.spec.ts`** (m3-full, 2 specs):
1. **Organizer uploads a Stage 2 image.** Same pattern as Stage 1: reset → admin generate + commit → organizer upload. Asserts: Stage 2 doc has `imageUrl: data:image/jpeg;base64,...`, `published: true`, `publicConfirmCount: 0`, audit log gets the entry, officer + admin get notified.
2. **Organizer cannot re-upload once a report exists** (Q4: refuse if `m4TicketId` is set). Test: organizer uploads → public user reports → organizer tries to replace → refused with a clear error. (No M4 response yet; the report is "open".)

**`stage2-public-confirm-report.spec.ts`** (m3-full, 4 specs):
3. **Public viewer confirms.** Login as `public` → navigate to `/events/{evtId}` → click 👍 → assert `publicConfirmCount` increments to 1.
4. **Same user can't confirm twice.** Click 👍 again → refused with `alreadyConfirmed: true`.
5. **Public viewer reports.** Login as `public` → click 🚩 → fill modal → submit. Asserts: `public_reports/{ticketId}` doc exists with `outcome: 'under_review'`; Stage 2 doc has `m4TicketId: ticketId`; officer + admin + organizer get `stage2_reported` notifications.
6. **Same user can't report twice.** Click 🚩 again → refused with `alreadyReported: true`.

`frontend/tests/m3/global-setup.ts` `seedEventControls` doesn't need Stage 2 docs (the new tests upload them on the fly). The existing `resetApprovedEvent()` already wipes `event_controls/*` + their `stage1_docs/*` sub-collections; needs to also wipe `stage2_docs/*` + `stage2_confirms/*` + `stage2_reports/*` sub-collections. Small admin-reset update.

### 2j. Docs (1 commit, the 3rd of the round)

- `M3_GAP_ANALYSIS.md`:
  - TL;DR counts: 25/3/12 → 28/3/9 (70% / 7% / 22%).
  - UC-35, UC-36, UC-37, UC-38 ❌ → ✅.
  - FR table: FR-M3-27, FR-M3-28, FR-M3-29 ❌ → ✅.
  - FR counts: 18/3/10 → 21/3/7.
  - Workstream 4 section: flip to SHIPPED.
- `M3_INTEGRATION_CONTRACT.md`:
  - §2: add `submitStage2Doc`, `confirmStage2Doc`, `reportStage2Doc` rows.
  - §3 NotificationType: add `'stage2_reported'`. AuditAction: add `'stage2_submitted'` + `'stage2_confirmed'` + `'stage2_reported'`.
  - §3 Stage 2 doc shape: add `reportedAt?` + `m4TicketId?` (already on the type; just link from the contract).
  - §4: new rate-limit sub-collections (server-only writes, signed-in reads).
  - §7 (Q5): M2 dependency unchanged (still real `proposeEventControlList` owed).
  - §10: Workstream 4 row SHIPPED.
- `M3_REVIEW.md`:
  - Header: latest commit, 49/49 specs (43 + 6).
  - New section 5f.
  - §6 open items: remove the "Workstream 4 is NEXT" item (now done); renumber.

### 2k. 3-commit structure (per your default granularity)

- `feat(m3): Workstream 4 - Stage 2 organizer upload + public confirm/report`
- `test(m3): Workstream 4 specs (2 organizer + 4 public)`
- `docs(m3): reflect Workstream 4 shipped`

---

## 3. Dependencies on other modules

- **M1 owner**: no new fields needed. `event.controlListGenerated` already exists; `organizerId` is the only M1 field we read.
- **M2 owner**: still owes the real `proposeEventControlList`. WS4 doesn't care — we use whatever the AI / stub produced.
- **M4 owner**: WS4 writes to `public_reports/{ticketId}` with `outcome: 'under_review'`. M4 will later update `outcome` to `'confirmed_true'` / `'dismissed_fake'`. **No M4 input needed for WS4 to ship** — the M4 trigger that responds is Workstream 6.
- **Public viewer**: needs the public auth (Google sign-in for the "kongjiyu0198@gmail.com" test fixture, plus any real signed-in user). Anonymous read is NOT supported (per the existing rules; any `isSignedIn()` check).

---

## 4. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Public read opens `stage2_docs` to any signed-in user | The `published == true` gate is in the rule; organizer + WS5 admin can unpublish to hide during sanitisation. |
| A user with many `publicConfirmCount` could spam confirm | Confirms are per-user rate-limited (one confirm per user per control) but not globally capped. If spam becomes a problem, WS4 can add a global cap (`if publicConfirmCount > 1000 then no-op`). Not in WS4 scope. |
| Re-upload overwrites the existing `m4TicketId` and breaks M4's tracking | Preserve `m4TicketId` on re-upload (per §2a) so the M4 ticket still points to the same control. The new image becomes the "resubmitted" version; M4 can see the ticket timeline. |
| Re-upload while a report is open | Refuse the replace (Q4). Organizer must wait for M4's outcome to clear the ticket. |
| 700 KB image cap is too small for venue photos | Same cap as Stage 1 (which covers receipts). If real venue photos need more, raise to 1.5 MB. The 1.5 MB binary → ~2 MB base64 → 2 MB in Firestore doc; well under the 1 MB cap. So actually 700 KB is the limit. For higher-res photos, use Firebase Storage (out of WS4 scope; would need new rules). **My pick: keep 700 KB for WS4, raise to 1.5 MB if a real test reveals the cap is too tight.** |
| Stage 2 doc carries the `published: true` flag set by the organizer, bypassing the admin publish step | WS5 adds the admin "Publish to public" page that re-publishes (with sanitisation) for events where the org's auto-publish needs review. Until WS5, the organizer's upload is the publish event. |
| Counter sub-collections (`stage2_confirms/*`, `stage2_reports/*`) might collide with the existing `decisions/*` collection name pattern | New collection names (`stage2_confirms`, `stage2_reports`) don't collide. Add to `COLLECTIONS` in `shared/types.ts`. |
| A user reports then immediately the organizer replaces; `m4TicketId` was preserved but the image is new | The new image becomes the "current" Stage 2 evidence; M4's ticket tracks the ticket lifecycle, not the image. The organizer can note the change in the audit log; M4 can re-investigate against the new image. |
| Public viewer needs a real test fixture user | `kongjiyu0198@gmail.com` is already in the test fixture (UAT public). |
| Two signed-in public users in a test (for the "different user can confirm" assertion) | Add a second public test fixture OR use the admin (who can also act as public). See §6 Q1. |

---

## 5. Verification

- All 43 existing specs still pass.
- 6 new specs pass: m3-full 22 → 28.
- Total: 49/49 specs across 3 projects (m3-smoke 14, m3-full 28, m3-workstream1 7).
- Manual smoke:
  1. Log in as `uat-organizer@steras.test`.
  2. Open `/organizer/events/evt-001-kl-music-festival/controls` after admin has generated + committed the control list.
  3. PDRM card has a Stage 2 row with "Not uploaded yet" + Upload button.
  4. Upload a JPEG → row flips to "Awaiting public verification" + shows the image preview.
  5. Log in as `kongjiyu0198@gmail.com` (public).
  6. Open `/events/evt-001-kl-music-festival` (or whatever the public URL is).
  7. PDRM card has 👍 Confirm + 🚩 Report buttons.
  8. Click 👍 → count increments to 1; button shows "You confirmed".
  9. Click 👍 again → refused (no change).
  10. Click 🚩 → modal opens with category + description fields.
  11. Submit → `public_reports/{ticketId}` is written; Stage 2 row shows "Reported to M4" badge.

---

## 6. Decisions I need from you

### Q1. Rate-limit policy for confirm (per control, per user)

- **A**: 1 confirm per user per control (hard cap; subsequent calls are no-ops). This is the same shape as A30's report rate-limit.
- B: Unlimited (any signed-in user can click 👍 many times; the counter just keeps going up). Simplest implementation but enables accidental spam.
- **C** (my pick): 1 confirm per user per control (same as A30). It's the conservative choice and the cost is trivial — 1 extra Firestore read per call. The benefit is you can't make a control "look confirmed" by spamming.

### Q2. Audit log on every confirm

- A: No audit log entry per confirm. Volume is high; the count is the audit.
- B: One entry per unique user (i.e. the first confirm per user per control). Auditable without spam.
- **C** (my pick): One entry per unique user (B). Cheap to write; gives a paper trail of who confirmed what; the M4 trigger (WS6) can re-read if needed. The total volume is bounded by the number of distinct public users (much smaller than the click volume).

### Q3. Public viewer's test fixture user

- **A**: Use the existing `kongjiyu0198@gmail.com` fixture for all public confirm/report specs. The "different user can confirm" assertion is skipped (or asserted via the rate-limit logic at the function level rather than via two real users).
- B: Add a second public user fixture (e.g. `kongjiyu0198+2@gmail.com`) for the "different user" assertion. One more auth user; one more seeder entry.
- **C** (my pick): A for the first 5 specs (single-user); B if you want the "different user" assertion to be E2E. The function-level logic is what we're really testing; the E2E is nice-to-have. **My pick: A.** If you want B, say so.

### Q4. Organizer replace after a report

- A: Allow replace always (organizer can override the report by uploading a new image; the M4 ticket stays open and references the new image).
- **B**: Refuse replace if `m4TicketId` is set (organizer must wait for M4's outcome to clear the ticket). Conservative; matches the spirit of "data is significant".
- **C** (my pick): B. The M4 investigation needs to anchor on a stable image. If the organizer replaces, M4's investigation becomes ambiguous ("was the original image wrong or the new one?"). Forcing the organizer to wait for M4's outcome keeps the chain of custody clean.

### Q5. Stage 2 image size cap

- A: 700 KB binary (same as Stage 1).
- **B** (my pick): 700 KB for now; raise to 1.5 MB if a real test reveals the cap is too tight. The 1 MB Firestore doc limit means we can go up to ~1.5 MB binary with some header overhead. For higher-res photos, that's still tight; real production would need Firebase Storage.
- C: Use Firebase Storage from the start (breaks the project convention; needs new rules + a download-URL flow).

---

## 7. Out of scope (explicitly deferred)

- **Admin publish / sanitisation** (Workstream 5, UC-14, UC-15, FR-M3-21). WS4 ships the auto-publish on organizer upload; WS5 adds the admin re-publish with sanitisation.
- **M4 outcome trigger** (Workstream 6, UC-30/31/32, FR-M3-30/31). The M4 → M3 trigger listens to `public_reports/{id}.update` and updates the control's `label`.
- **Initial review stage** (its own round).
- **Firebase Storage for larger images** (would need a new rules block + Cloud Function changes; not needed for the demo).
- **Rate-limit UI** (e.g. "You have 0 reports left today"). The A30 1-report-per-control is the only rate-limit in WS4.
- **Public viewer's anonymous read** (would need a different auth model + rate-limiting; not in scope).

---

**Bottom line:** 3 commits (impl / test / docs), 3 new Cloud Functions, 1 organizer UI row, 1 public viewer extension, 6 new specs (49/49 total), and 5 small decisions above. Once you sign off on §6, I'll start.
