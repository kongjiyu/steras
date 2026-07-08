# Module Mapping & Build Status

> Per PRD §8: **Module 1 → 2 → 3 → 4 → 5**

## Status legend
- ✅ **Scaffolded** — base files exist, type-safe, ready for logic
- 🟡 **Wired** — real Firestore / API calls in place, but key logic still placeholder
- ⏳ **Pending** — not yet started by lead

---

## Module 1 — Event Management
**Lead:** Requirement Lead · **Support:** Project Manager

| File | Status | Notes |
|------|--------|-------|
| `frontend/src/pages/organizer/NewEvent.tsx` | ✅ | Full form with all PRD fields |
| `frontend/src/pages/organizer/MyEvents.tsx` | ✅ | Real-time Firestore listener + status filter |
| `frontend/src/pages/organizer/EventDetail.tsx` | ✅ | Shows event + risk + resources side-by-side |
| `firestore.rules` | ✅ | Role-based access enforced |

## Module 2 — Smart Risk Assessment
**Lead:** Programmer · **Support:** Design Lead (scoring formula + AI prompt)

| File | Status | Notes |
|------|--------|-------|
| `functions/src/engines/ruleBased.ts` | ✅ | All 5 sub-scorers, weighted sum, deterministic |
| `functions/src/engines/aiPredictor.ts` | ✅ | Anthropic SDK, structured JSON output, prompt versioning |
| `functions/src/triggers/onEventCreated.ts` | ✅ | Auto-runs on new event |
| `functions/src/utils/weather.ts` | ✅ | OpenWeather integration with fallback |
| `functions/src/utils/holidays.ts` | ✅ | Malaysian public holiday list (2025-2026) |

**TODO from lead:**
- Replace `getRiskLevel` thresholds if team agrees on different bands
- Add more detailed venue history lookup (proper venueId join)
- Add one-call API for severe weather alerts (currently proxy)

## Module 3 — Safety Resource Recommendation
**Lead:** Design Lead · **Support:** Programmer (formula impl)

| File | Status | Notes |
|------|--------|-------|
| `functions/src/engines/resourceCalculator.ts` | ✅ | All 7 resource types from PRD table |
| Confidence flag | ✅ | `confidenceLevel: 'estimate'` set, awaiting authority validation |

**TODO from lead:**
- Replace prototype formulas with authority-validated values (per PRD table footnote)
- Add resource override workflow for amendment

## Module 4 — Authority Dashboard
**Lead:** Programmer · **Support:** Design Lead (UI/UX), Tester

| File | Status | Notes |
|------|--------|-------|
| `frontend/src/pages/authority/ReviewQueue.tsx` | ✅ | Real-time pending queue |
| `frontend/src/pages/authority/AuthorityEventReview.tsx` | ✅ | AI vs Rule side-by-side, decision buttons, audit log |
| `frontend/src/components/ui/RiskBadge.tsx` | ✅ | Color-coded risk level |
| `functions/src/triggers/onDecisionMade.ts` | ✅ | Audit log + public_events publish on approval |

**TODO from lead:**
- Move status transitions to Cloud Function (currently client-side update — bypasses rules via "decidedBy" field; refactor to call `manualRecompute`-style HTTP endpoint)
- Add filter UI (by risk level, event type, date) — currently basic

## Module 5 — Analytics & Reporting
**Lead:** Tester · **Support:** Programmer (chart integration)

| File | Status | Notes |
|------|--------|-------|
| `frontend/src/pages/authority/Analytics.tsx` | 🟡 | 3 charts wired (agreement, risk level, avg over time) |
| Chart.js + react-chartjs-2 | ✅ | Installed |
| CSV / PDF export | ⏳ | Not yet |
| "Top risky venues" | ⏳ | Not yet |
| "Most disagreed applications" | ⏳ | Not yet |

**TODO from lead:**
- Optimize: replace `collection(COLLECTIONS.RISK_SCORES)` collection scan with `collectionGroup` + indexes
- Add CSV export button (suggest `papaparse` lib)
- Add date range filter

---

## Firestore Schema

| Collection | Doc shape | Server-only writes |
|------------|-----------|-------------------|
| `users` | `UserProfile` | role changes |
| `events` | `EventRecord` | status transitions (Pending → ...) |
| `events/{id}/risk_scores` | `RiskScoreRecord` | ✅ (Cloud Function) |
| `events/{id}/resources` | `ResourceRecommendation` | ✅ (Cloud Function) |
| `events/{id}/audit_logs` | `AuditLog` | ✅ (Cloud Function, append-only) |
| `venues` | `Venue` | ✅ (seed script) |
| `incidents` | `Incident` | ✅ (seed script) |
| `public_events` | `PublicEvent` | ✅ (on Approved) |

See `firestore.rules` for full access matrix.

---

## External APIs

| API | Used for | Cost control |
|-----|----------|--------------|
| MiniMax M3 (Anthropic-compatible) | AI risk + resource prediction | 1000 calls/day cap; cache identical requests in Cloud Function |
| OpenWeather | Weather forecast (5-day free tier) | 1000 calls/day; 30-min in-memory cache |

Both have a graceful-degrade path: if either fails, the system runs rule-based only and shows a warning to the authority.

---

## Open Questions (from PRD §16)

1. **AI prompt detail level** → Current system prompt is detailed but not overlong. Tune via `promptVersion` field.
2. **MiniMax cost monitoring** → Suggest Firebase budget alert at 50%/80% (set in Google Cloud Console).
3. **Firebase project setup** → Need Google Cloud account access; whoever has it should run `firebase use --add`.
4. **Test data** → Seed script at `functions/src/seed/seedVenues.ts` covers 10 venues. Expand to 20-30.
5. **AI vs rule-based UI prominence** → Current UI shows both side-by-side. Authority can scan the disagreement banner for outliers.
