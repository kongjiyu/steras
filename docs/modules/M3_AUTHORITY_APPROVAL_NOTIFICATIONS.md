# M3 — Authority Approval and Notification

**Owner:** Module 3 teammate

**PRD requirements:** FR-M3-01 to FR-M3-32

## Goal

Own the human authority workflow: review applications and M2 evidence, record scoped decisions with justification, aggregate multi-agency outcomes, publish approved events, and notify organisers.

M3 never changes the official M2 score or represents AI as the decision-maker.

## Current Progress

- Authority dashboard, assigned review queue, event review, evidence download, versioned authority decisions, decision history, resource override, audit writes, multi-authority aggregation, and approved-event publication are implemented.
- The current backend already scopes actions by `authorityType` and required authority membership.
- Durable notifications, verified-control actions, explicit M2 readiness/compliance gates, named-officer assignment, Stage 1/2 evidence and public reporting are implemented. The STERAS build is deployed to the shared Firebase project `linkos-496505` for testing.

## Current Delivery Goal

Complete the human authority workflow: enforce readiness/compliance gates, verify controls with provenance, aggregate version-scoped decisions, publish only unanimous approvals, and create durable organiser notifications. See `docs/TEAM_GOALS.md`.

## Owned Pages

| Route | Page | Responsibility |
|---|---|---|
| `/authority` | `pages/authority/AuthorityDashboard.tsx` | Assigned portfolio and operational summary |
| `/authority/applications` | `pages/authority/ReviewQueue.tsx` | Search, filter, sort, and open assigned applications |
| `/authority/events/:eventId` | `pages/authority/AuthorityEventReview.tsx` | Evidence review, M2 result consumption, resource override, and human decision |
| `/authority/audit` | Planned review/audit page | Review and decision history; currently redirects |
| `/authority/users` | Deferred authority-account administration | Currently redirects |
| `/authority/settings` | Deferred authority settings | Currently redirects |

M3 owns each full page file above. M2 supplies assessment/resource contracts and future reusable components.

## Owned Backend and Data

- `functions/src/http/authorityDecision.ts`
- `functions/src/http/overrideResources.ts`
- `functions/src/http/manualRecompute.ts` permission and review integration
- authority decision aggregation and public publication
- `events/{eventId}/decisions/{authorityType}`
- `events/{eventId}/decision_history/{decisionId}`
- `events/{eventId}/resource_overrides/{overrideId}`
- M3 decision, override, status, publication, and notification audit entries
- future `notifications` collection and delivery triggers

## Locked Review Model

The latest PRD requires the full initial, multi-department, and second-review workflow:

1. An authority account has one `authorityType`: PDRM, BOMBA, KKM, DBKL, or MOTAC.
2. Submission determines `requiredAuthorities`.
3. Admin performs the initial review and either rejects the current version or advances it to named-officer review.
4. Each assigned authority officer records one current proposal per application version.
5. After all assigned officers finish, Admin records the authoritative second-review Approve/Reject result.
6. Event applications have no Amendment decision. A rejected version is immutable, but the organizer may prepare and submit a corrected new version under FR-M1-16.
7. Request resubmission remains exclusive to event-control documents.
8. A new submitted version invalidates previous current decisions without deleting their history.

## Locked Decision Contract

- Event application decisions are Approved or Rejected. Reject closes the reviewed version; a corrected application is a new immutable version, not an Amendment decision.
- Every action requires 10–1,000 characters of human rationale.
- Reviewer UID, authority type, application version, timestamp, and current/history state are mandatory.
- An authority may act only when its type appears in `requiredAuthorities`.
- Assessment and resources must be ready before a decision.
- AI may suggest wording in a future feature, but a human must review/edit it before sending and the stored rationale remains human-owned.
- Resource overrides require the same scoped authority check and preserve previous/current quantities.

## Notification Assumption

Firestore real-time status is the mandatory baseline. Implement `notifications/{notificationId}` for durable in-app notifications with:

- recipient UID;
- event/version ID;
- type and title;
- privacy-safe message;
- created/read timestamps;
- source action ID for idempotency.

Push notification is optional until FCM configuration exists. A push failure must not roll back the decision.

## Inputs From Other Modules

| Provider | M3 consumes |
|---|---|
| M1 | Event/version data, evidence paths, organiser ownership, and required authorities |
| M2 | Official HIRARC residual hazards, separate readiness/compliance gates, advisory explanation, evidence confidence, resource planning ranges/rationale, and AI retry status |
| M4 | Incident triage, assignment, and investigation queues where authority action is required |

## Outputs To Other Modules

| Consumer | M3 provides |
|---|---|
| M1 | Aggregate status, current/history decisions, revision/rejection rationale, notifications, and public publication |
| M4 | Authority identity/scope and decision links for incident assignment or escalation |
| M5 | Decision outcomes, timestamps, reviewers/authority type, overrides, review duration, and publication state |

## Remaining Work

- Keep the STERAS `steras-module3-test-v2` fixture set and the three single-worker Playwright suites green after cross-module merges.
- Preserve pointer-driven compatibility with M2 assessment/resource revisions and keep resource adjustments append-only.
- Optional FCM delivery remains an enhancement; durable in-app notifications are already implemented.
- Add editable AI-assisted rejection/revision wording only after the human-edit boundary is tested.
- Decide whether `/authority/audit` needs a standalone page or remains part of event review.
- Add M4 incident navigation when the triage and investigation queue exists.
- Retain deployment reports, Playwright traces and fixture verification output for each STERAS Firebase test release.

## Definition of Done

- Assigned authorities can review complete M1/M2 evidence and only their assigned events.
- Duplicate/concurrent decisions cannot create an invalid aggregate status.
- Every decision and override is version scoped, justified, and auditable.
- Only unanimous same-version approval publishes a sanitised public event.
- Organisers receive real-time status and durable notification updates.
- M3 pages pass desktop/mobile, empty/error/loading, permission, and keyboard checks.

