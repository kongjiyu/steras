# M3 — Authority Approval and Notification · Review Pack

**For:** M3 teammate (the human who owns the module)
**Last commit on `anny_cont`:** `0526286`
**Reviewer entry point:** this file
**Status:** 14/14 @M3 Playwright specs pass on the deployed Firebase project (`linkos-496505`).

This document is a self-contained review pack. It tells you:

1. What M3 owns and what is **out of scope** for you.
2. What changed in the `anny_cont` round (the work under review) versus the pre-existing M3 foundation.
3. Where every file lives, so you can `git blame` / open in your editor.
4. How to verify each capability by hand in the deployed app.
5. How to run the automated E2E test suite.
6. What's intentionally still open, and the questions I have for you.

> The PR-style commit list at the bottom (`Commit log under review`) is the audit trail — every change is one commit with a focused message.

---

## 1. Module boundaries (from PRD + handoff)

You are the **M3 teammate**. The PRD (`STERAS_PRD.md` §FR-16..22) and `docs/team-handoffs/M3_TEAMMATE_HANDOFF.md` define your scope as:

**In scope (you own):**
- Human authority review workflow.
- Multi-agency decision aggregation.
- Resource override.
- Approved-event publication.
- Verified-control workflow (Stage-1 control verification by an authority officer).
- Durable in-app notifications to the organiser.
- Standalone audit page (still planned, see §6 open items).

**Out of scope (do NOT touch):**
- M2 official HIRARC score, readiness, compliance, advisory, evidence, resources.
- M1 organiser/event lifecycle.
- M4 incident/complaint queues.
- M5 analytics exports.
- LLM auto-approve/auto-reject. AI may only **suggest** wording in a future feature; today the rationale is human-only.
- Push notification (FCM) — the spec calls real-time status the mandatory baseline; FCM is optional until configured. The implementation follows the baseline.

Cross-module contracts (don't break these):
- **From M1** you consume: event/version records, evidence paths, organiser ownership, `requiredAuthorities`.
- **From M2** you consume: official residual hazards, `assessmentReadiness`, `complianceStatus`, advisory explanation, evidence confidence, resource ranges.
- **To M1** you provide: aggregate status, decision rationale, revision/rejection details, notifications, publication state.
- **To M4** you provide: authority identity/scope and escalation decision links (when M4 lands).
- **To M5** you provide: decision outcomes, review stages, timestamps, authority type, overrides, publication state.

---

## 2. What was already there vs. what I added

**Already implemented (pre-`anny_cont`):**
- Authority dashboard, assigned review queue, event review page.
- Evidence download.
- Authority-scoped decision Cloud Function with versioned history.
- Multi-authority aggregation (`Approved` requires unanimous same-version; any `Rejected` wins; otherwise `AmendmentRequested`).
- Resource override with provenance.
- Audit writes.
- Approved-event publication to `public_events/{eventId}`.

**Added on `anny_cont` (this round, what you must review):**
1. **M2 compliance gate** — `complianceStatus === 'blocked'` ⇒ Approve is rejected with `failed-precondition`.
2. **Readiness rationale gate** — when `assessmentReadiness` is `provisional` or `insufficient_data`, the rationale must be ≥80 chars.
3. **`verifyEventControl` Cloud Function** — server-mediated Stage-1 control verification with full provenance (`controlId`, `authorityType`, `reviewerUid`, `evidencePath`, `timestamp`, `versionId`).
4. **Durable notifications** — `notifications/{notificationId}` with idempotent `sourceActionId`, recipient-scoped reads, `markNotificationRead`.
5. **NotificationBell UI** — real-time unread count + dropdown panel in `WorkspaceTopBar`.
6. **Stage-1 control verification form** — a new section in `AuthorityEventReview` with verify/reject form + read-only provenance for completed controls.
7. **Firestore rules** — `/notifications/{id}`, `/event_controls/{id}`, `/control_verifications/{id}`.
8. **Composite index** — `notifications` on `(recipientUid ASC, createdAt DESC)`.
9. **`resolveAuthUid()` helper** — robust against legacy `organizerId` values in the seed (`usr-org-002` style that don't match a real user doc).
10. **14-spec Playwright E2E suite** covering the gates, aggregate precedence, verified-control workflow, organiser notifications, and the new UI form.

---

## 3. File map (everything that changed or is new)

### Cloud Functions — `functions/src/`
| File | Status | Purpose |
|---|---|---|
| `http/authorityDecision.ts` | modified | Added compliance + readiness gates; resolves recipientUid via `resolveAuthUid`; calls `createNotification` post-transaction. |
| `http/verifyEventControl.ts` | **new** | `verifyEventControl` callable; persists full provenance; updates `event.verifiedControlIds`; writes audit + organiser notification. |
| `http/notifications.ts` | **new** | `listMyNotifications` + `markNotificationRead` (server-scoped by `request.auth.uid`). |
| `utils/notifications.ts` | **new** | `createNotification` helper (idempotent on `sourceActionId`); `resolveAuthUid` (user doc → auth UID). |
| `triggers/onEventCreated.ts` | modified | Skips M3 negative-test fixture ids so pre-seeded `complianceStatus` / `assessmentReadiness` survive. |
| `index.ts` | modified | Exports the three new functions. |

### Shared types — `shared/types.ts`
- `COLLECTIONS.NOTIFICATIONS` / `EVENT_CONTROLS` / `CONTROL_VERIFICATIONS`
- `Notification` interface
- `ControlVerification` interface
- `NotificationType`, `ControlVerificationStatus`
- `EventRecord.verifiedControlIds?: string[]`
- `AuditAction` now includes `'control_verified' | 'control_rejected'`

### Firestore — root
| File | Change |
|---|---|
| `firestore.rules` | Added `/notifications/{id}` (read own only, writes server-only), `/events/{eventId}/event_controls/{id}` and `/control_verifications/{id}` (read by assigned authority, event owner, admin; writes server-only). |
| `firestore.indexes.json` | Added composite index for `notifications` (recipientUid ASC, createdAt DESC). |

### Frontend — `frontend/src/`
| File | Status | Purpose |
|---|---|---|
| `pages/authority/AuthorityEventReview.tsx` | modified | New "Stage-1 control verification" section; per-control form (rationale + optional evidence path); status badges; read-only provenance for completed controls. |
| `components/layout/NotificationBell.tsx` | **new** | Bell icon + unread badge + dropdown panel; real-time `onSnapshot`; mark-read via Cloud Function. |
| `components/layout/Sidebar.tsx` | mounted | `<NotificationBell />` between date and avatar in `WorkspaceTopBar`. |
| `config/firebase.ts` | unchanged for you | Exposes the `__sterasFirebase` global that the Playwright fixtures use. |

### Tests — `frontend/tests/m3/`
| File | Status | Specs |
|---|---|---|
| `global-setup.ts` | **new** | Admin SDK reset + creates 3 negative-test fixtures (`evt-compliance-blocked`, `evt-provisional-readiness`, `evt-control-verification`). |
| `admin-reset.ts` | **new** | Per-test helpers (`resetFoodFair`, `resetMountainRun`) using Admin SDK to bypass client rules. |
| `fixtures.ts` | **new** | Shared `api` helper (Firestore + Cloud Functions via `__sterasFirebase`), `loginAs`, `ACCOUNTS`, `EVENTS`. |
| `pdrm-decision.spec.ts` | **new** | Happy path: PDRM Approve on assigned event. |
| `m3-negative-gates.spec.ts` | **new** | 4 specs: compliance-blocked, short-rationale, long-rationale, non-assigned authority. |
| `m3-aggregate.spec.ts` | **new** | 3 specs: rejection-precedence, amendment-precedence, unanimous-publish. |
| `m3-controls-notifications.spec.ts` | **new** | 4 specs: KKM-cannot-verify, PDRM-verifies, organiser-receives, markNotificationRead. |
| `control-verification-ui.spec.ts` | **new** | 2 UI smoke specs for the Stage-1 control verification form. |

### Branch / deploy
- Branch: **`anny_cont`** (NOT merged to main; you said "don't merge until I signal").
- All Cloud Functions deployed to `asia-southeast1` on the `linkos-496505` project.
- Firestore rules + index deployed.
- Frontend (hosting) deployed to `https://linkos-496505.web.app`.

---

## 4. Manual verification steps (deployed app)

You can verify everything in the live app without running tests. Use the seeded UAT accounts (all password `Steras@Reset2026!`):

| Email | Role | What you can verify |
|---|---|---|
| `uat-organizer@steras.test` | organizer | Event list, event detail, notification bell after decisions. |
| `steras-admin@steras.test` | admin | Admin dashboard, admin event review, M3 review queue. |
| `uat-pdrm@steras.test` | authority:PDRM | Decision form, Stage-1 control verification form. |
| `uat-bomba@steras.test` | authority:BOMBA | Same as PDRM. |
| `uat-kkm@steras.test` | authority:KKM | Same. |
| `uat-dbkl@steras.test` | authority:DBKL | Same. |
| `kongjiyu0198@gmail.com` | public | Public calendar / public event detail (only approved events). |

### Smoke test — happy path (5 min)
1. Open `https://linkos-496505.web.app/login`, sign in as **PDRM**.
2. Go to `/authority/applications`, open **`evt-002-pj-food-fair`** (UnderReview, requires PDRM/BOMBA/KKM/DBKL).
3. You should see:
   - The M2 assessment card.
   - The "Recommended resources" card.
   - The "Submitted evidence" card.
   - The new **"Stage-1 control verification"** card (this event has no controls — the section is hidden for events without controls, see `ControlVerificationSection` returns `null`).
   - The "Your decision" card with the 3 buttons (Approve / Request amendment / Reject).
4. Type ≥10 chars of rationale, click **Approve**. Toast: "Approval recorded." Status pill moves to "Under Review" (still waiting on the other 3 authorities).
5. Sign out, sign in as **BOMBA**, **KKM**, **DBKL** in turn, repeat. After the 4th approval, the event becomes `Approved` and a public projection is written.
6. Sign in as the **organizer**. The bell (top-right) shows an unread count. Open it — you see 4 notifications:
   - 3 × `decision_made` (the first 3 authorities).
   - 1 × `application_approved` (the 4th that triggered unanimous approval).
7. Click one notification — it marks as read; the count decrements. Refresh; it stays read (durable).

### Smoke test — compliance gate
1. Sign in as **PDRM**, open **`evt-compliance-blocked`**.
2. The Approve button is enabled (UI doesn't pre-block; the gate is server-side). Type any rationale, click **Approve**.
3. Toast: an error message — *"This application cannot be approved while M2 compliance status is "blocked"…"* (thrown by the Cloud Function as `failed-precondition`).
4. The decision is **not** recorded; the event stays `UnderReview`. The Reject / Amendment Requested buttons still work.

### Smoke test — readiness rationale gate
1. Sign in as **PDRM**, open **`evt-provisional-readiness`**.
2. Try to Approve with a short rationale (e.g. 30 chars). Server rejects with *"When the assessment is provisional, the decision rationale must explain the gap (at least 80 characters)."*
3. Try again with 80+ chars. Approved (assuming no other gate trips).

### Smoke test — Stage-1 control verification
1. Sign in as **BOMBA**, open **`evt-control-verification`** (has 4 declared controls seeded).
2. Scroll to the new **"Stage-1 control verification"** card. You see 4 controls, each with a Verify / Reject pair and a rationale textarea.
3. Fill the first control's rationale (≥10 chars), click **Verify**. Toast: "Control verified." The control flips to a green "Verified" badge with provenance (reviewer, timestamp, rationale).
4. Try the same as **KKM** — they are NOT in `requiredAuthorities` for this event, so the section renders read-only ("Your account is not assigned to this application."). Same view with KKM's bell: a `control_verified` notification arrives.

### Smoke test — rejection precedence
1. Use `m3-aggregate` test or do it manually: PDRM Rejects, then BOMBA tries to Approve. Server rejects BOMBA's Approve with *"This application version is no longer open for review."* The aggregate stays `Rejected`. `public_events/{id}` is empty.

---

## 5. Automated test verification (Playwright)

### Run all M3 specs
```bash
cd frontend
npx playwright test --grep "@M3" --reporter=list
```

Expected: **14/14 passed** in ~2–3 minutes.

### Run a single spec
```bash
npx playwright test tests/m3/m3-negative-gates.spec.ts
npx playwright test tests/m3/m3-aggregate.spec.ts
npx playwright test tests/m3/m3-controls-notifications.spec.ts
npx playwright test tests/m3/control-verification-ui.spec.ts
npx playwright test tests/m3/pdrm-decision.spec.ts
```

### What each spec proves

| Spec | Asserts |
|---|---|
| `pdrm-decision` › PDRM approves an assigned event | Happy path: a single Approve decision is recorded with the right `decisionId`, `current=true`, status moves to `UnderReview`. |
| `m3-negative-gates` › compliance-blocked | Server rejects Approve with a `complianceStatus=blocked` assessment. |
| `m3-negative-gates` › short-rationale rejected | `provisional` readiness + 30-char rationale is rejected (`invalid-argument`, msg mentions 80). |
| `m3-negative-gates` › ≥80 char rationale accepted | Same event + 100-char rationale is accepted. |
| `m3-negative-gates` › non-assigned authority | A KKM officer acting on a `[PDRM, BOMBA]` event is rejected (`permission-denied`, "not assigned"). |
| `m3-aggregate` › rejection precedence | One Reject → aggregate `Rejected`; no `public_events`; subsequent BOMBA Approve is rejected; aggregate stays `Rejected`. |
| `m3-aggregate` › amendment precedence | One `AmendmentRequested` → aggregate `AmendmentRequested`; no public event. |
| `m3-aggregate` › unanimous publish | All 4 authorities Approve on the same version → `Approved`; `public_events` row exists; `publicStatus='approved'`; `approvedBy` contains all 4. |
| `m3-controls-notifications` › KKM cannot verify | KKM on a non-KKM event → `permission-denied` from `verifyEventControl`. |
| `m3-controls-notifications` › PDRM verifies | PDRM verifies a declared control → `result.status === 'verified'`. |
| `m3-controls-notifications` › organiser receives | After 4 Approve decisions, the organiser's `listMyNotifications` returns ≥1 row, with at least one `application_approved`. |
| `m3-controls-notifications` › markNotificationRead | `markNotificationRead` flips `read` to `true`; subsequent `listMyNotifications` confirms the change. |
| `control-verification-ui` › PDRM sees the form | UI section renders with Verify / Reject buttons visible. |
| `control-verification-ui` › BOMBA verifies through the UI | Filling the textarea + clicking Verify persists a verification with `status='verified'`. |

### What I do NOT yet have a test for (and why)
- **Concurrent / parallel decisions** — would need a load generator; out of scope for a prototype.
- **Re-submission invalidates prior decisions** — old behavior; not changed. Worth a regression test if M1's resubmission flow lands.
- **Mark notification read while offline / on a different device** — relies on `readAt`; works in practice but no test.
- **Org-side rendering of the notification bell dropdown** — Playwright test exercises the API; the UI is the same `onSnapshot`-driven component as the rest of the app.

---

## 6. Open items & questions for you

1. **Stage-1 control list generation is NOT in this round.** `verifyEventControl` and the UI form work great against pre-existing `event_controls` docs, but no production code path creates those docs. Today they come from `functions/scripts/seedMockData.js` (mock seed) or `tests/m3/global-setup.ts` (test fixture). Per the handoffs, **M2 should generate the canonical control list from the HIRARC residual-hazard analysis** (each residual hazard implies a Stage-1 control to verify). M3 only verifies what's declared. M2 doesn't yet write `event_controls/{controlId}` docs after assessment finalisation. Three options: (a) hand it to M2 owner, (b) M3 generates on approval (couples M3 to M2's hazard model), (c) defer until M2 lands it. I recommend (a) — cleanest module split.
2. **Merge to main.** `anny_cont` has 6 new commits on top of `main`. Ready when you say so. I held off per your earlier "don't merge until I signal".
3. **`/authority/audit` standalone page.** Still planned (the route currently redirects to event review). M3 handoff says it can be part of the event review page or a standalone page. Your call.
4. **AI-assisted rejection/revision wording.** Explicitly out of scope for this round. The handoff says "after the human-edit boundary is tested" — let me know when M2's advisory export is stable.
5. **Push notification (FCM).** Not implemented. Spec says it's optional until FCM is configured. If you want it, I can layer it on top of the existing `createNotification` without touching the decision path.
6. **M4 escalation links.** The handoff calls for them; M4 doesn't exist yet. When M4 lands, I'll add the link shape.
7. **Debug specs removed.** `tests/m3/debug.spec.ts` and `debug2.spec.ts` were scratch; removed in `0526286`. If you want them back as regression scratchpads, say the word.
8. **Pre-existing TS errors in `frontend/src/`.** 41 errors (date-fns types, firebase/storage types, unused imports, etc.) exist in the codebase independent of M3. The vite build still succeeds. Worth a separate cleanup pass; I left them alone to keep the diff focused.

---

## 7. Commit log under review

```
0526286  chore(tests): remove debug.spec.ts and debug2.spec.ts scratch specs
3947c41  feat(m3): Stage-1 control verification UI in AuthorityEventReview + Firestore rules
5719300  fix(m3): 12/12 green — Firestore index for notifications + resolveAuthUid + seed organizer UID
baec261  chore(gitignore): exclude Playwright test-results, playwright-report, blob-report
361ef45  fix(m3): verifyEventControl — only write evidencePath/evidenceFile when defined
40f9add  test(m3): reset evt-002 in pdrm-decision beforeEach so order doesn't matter
a9a6f98  feat(m3): notification bell UI + 5 more E2E specs + skip-guard for test fixtures
52c4881  wip(m3): add M3 E2E test fixture handling
5437814  feat(m3): compliance + readiness gates, verifyEventControl, notifications
e1263fe  test(playwright): add M3 (Authority Approval) E2E harness + first PDRM spec
```

Commits before `e1263fe` were either the original M3 foundation (already in main) or the `anny_dev` branch's work I inherited. The above are the commits in the `anny_cont` branch waiting for your review.

---

## 8. Quick links

- Deployed app: <https://linkos-496505.web.app>
- Firebase console: <https://console.firebase.google.com/project/linkos-496505/overview>
- Function logs: <https://console.firebase.google.com/project/linkos-496505/functions/logs>
- PRD module spec: `docs/modules/M3_AUTHORITY_APPROVAL_NOTIFICATIONS.md`
- Teammate handoff: `docs/team-handoffs/M3_TEAMMATE_HANDOFF.md`
- This review pack: `docs/team-handoffs/M3_REVIEW.md` (this file)

---

**TL;DR for the impatient:**
- Your module: **M3 — Authority Approval and Notification** (M3 teammate role).
- The 9-point diff in §2 is what changed; everything else is the existing M3 foundation.
- 5-minute smoke test in §4 step 1 is the fastest way to feel the whole thing work.
- 14/14 Playwright specs pass.
- Branch is `anny_cont` — not merged. Tell me when you want to merge.
