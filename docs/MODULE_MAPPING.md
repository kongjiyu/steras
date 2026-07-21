# Module Mapping and Build Status

> Architecture source: `steras-prd.md` v2.1. Delivery sequence: Module 1 -> 2 -> 3 -> 4 -> 5.

## Status Legend

- **Ready:** implemented against the v2.1 contract and covered by an initial quality gate.
- **In progress:** partially wired; exit criteria are not complete.
- **Pending:** scheduled in `docs/IMPLEMENTATION_PLAN.md`.

## Foundation - In Progress

| Area | Status | Notes |
|---|---|---|
| npm workspaces and TypeScript | Ready | Frontend and Functions share `shared/types.ts` |
| ESLint, Vitest, Testing Library | Ready | Root `npm run check` is the quality gate |
| GitHub Actions | Ready | Typecheck, lint, tests, and build |
| Emulator integration tests | Ready | 15 Firestore/Storage authorization and workflow tests are active |
| Firebase staging | Ready | Singapore Firestore/Storage/Functions, Auth, Hosting, and secrets on `linkos-496505` |

## Module 1 - Event Management

| Area | Status | Primary Files |
|---|---|---|
| Event form and list | Ready | New/edit form, draft filters, and real-time list |
| Immutable versions | Ready | Transactional `events/{id}/versions/vN` submission |
| Document upload | Ready | Version-scoped PDF/image upload with 10 MB limit |
| Draft/submit/withdraw | Ready | Server-mediated submit and withdraw commands |
| Amendment/resubmit | Ready | v2 preservation and decision invalidation are emulator-tested |

## Module 2 - Smart Risk Assessment

| Area | Status | Primary Files |
|---|---|---|
| Deterministic baseline | Ready | `functions/src/engines/ruleBased.ts` |
| MiniMax bounded refinement | Ready | Strict allowlist/schema, nine-second timeout, fallback, and bounded cache |
| Final score and fallback | Ready | `functions/src/triggers/onEventCreated.ts` |
| Version idempotency | Ready | Transaction claim/lease and deterministic audit IDs are concurrency-tested |
| Weather/history hardening | Ready | One Call forecast cache/fallback freshness plus stable venue incident lookup |

## Module 3 - Resource Recommendation

| Area | Status | Primary Files |
|---|---|---|
| Seven prototype formulas | Ready | `functions/src/engines/resourceCalculator.ts` |
| Formula provenance | Ready | `ResourceRecommendation.formulaVersion` |
| Authority validation/override | Ready | Transactional server command, provenance, history, and review UI |

## Module 4 - Authority Review

| Area | Status | Primary Files |
|---|---|---|
| Dashboard and queue | Ready | Assigned-agency queue is bounded with search, sorting, counts, and pagination |
| Assessment provenance UI | Ready | Final, baseline, adjustment, sub-scores |
| Evidence and history | Ready | Assigned-only downloads, immutable versions, and decision rationales |
| Multi-authority decisions | Ready | Version-specific current decisions plus append-only history |
| Transactional publication | Ready | Unanimous approval publishes sanitized immutable-version data |

## Module 5 - Analytics and Public Views

| Area | Status | Primary Files |
|---|---|---|
| Required analytics charts | Ready | Assigned-agency applications/approvals, final risk, and baseline-versus-final |
| Public approved events | Ready | Sanitized calendar search/filter/grouping and real-time detail |
| CSV export and date filters | Ready | PII-safe export with spreadsheet-injection protection |
| Advanced analytics | Pending | High-risk venues/types, resource trends, and per-authority turnaround |

## Firestore Contract

| Path | Contract | Client Writes |
|---|---|---|
| `users/{uid}` | `UserProfile` | own safe profile fields |
| `events/{eventId}` | `EventRecord` | draft commands only |
| `events/{eventId}/versions/{versionId}` | `EventVersion` | server submission command |
| `events/{eventId}/assessments/{assessmentId}` | `AssessmentRecord` processing/failed/ready lifecycle | server only |
| `events/{eventId}/resources/{resourceId}` | `ResourceRecommendation` | server only |
| `events/{eventId}/decisions/{decisionId}` | `AuthorityDecision` | server only |
| `events/{eventId}/audit_logs/{auditId}` | `AuditLog` | server only, append-only |
| `public_events/{eventId}` | `PublicEvent` | server only, public read |

## Immediate Next Work

1. Automate the full organizer, authority, amendment, and public golden paths with Playwright.
2. Seed the complete Phase 8 venue, incident, event, and failure-scenario dataset.
3. Complete Edge and Safari keyboard verification and close accessibility findings.
4. Add App Check/abuse controls, retention policy, budget alerts, and backup rehearsal.
