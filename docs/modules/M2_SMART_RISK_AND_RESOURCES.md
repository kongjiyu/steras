# M2 — Smart Risk Assessment and Safety Resource Recommendation

**Owner:** M2 owner / project integrator

**PRD requirements:** FR-M2-01 to FR-M2-14

## Goal

Turn one immutable event version into an explainable official deterministic category result, an advisory MiniMax M3 explanation, and versioned indicative safety-resource quantities.

M2 never approves, rejects, requests revision, sends an organiser decision, or authorises real-world resource deployment.

## Current Progress

- The eight-domain all-hazards/HIRARC v2 engine, readiness, compliance, confidence, evidence provenance, verified-control handling, comparable history, MiniMax advisory/fallback, and resource planning ranges are implemented.
- M2 authority pages, reusable organiser/authority components, emulator demo fixtures, engine tests, Rules coverage, and live external-service verification exist.
- Remaining work is primarily cross-module: M3 control-verification provenance, M4 real incident/outcome data, M5 consumption, authority validation of resource assumptions, and final integration.

## Current Delivery Goal

Freeze and support the implemented all-hazards v2 contract while owning General integration. Prioritise cross-module fixtures, contract stability, end-to-end verification, and release coordination over another scoring redesign. See `docs/TEAM_GOALS.md`.

## Owned Pages and UI

| Route or component | Responsibility | Status |
|---|---|---|
| `/authority/risk` | Cross-application official assessment, advisory, and context-evidence monitoring | Implemented |
| `/authority/resources` | Cross-application resource quantities, rationale, version, and validation monitoring | Implemented |
| `components/m2/CategoryProfile.tsx` | Reusable official deterministic category breakdown | Implemented |
| `components/m2/AIAdvisory.tsx` | Clearly labelled advisory explanation that cannot replace the official result | Implemented |
| `components/m2/ContextEvidence.tsx` | Versioned weather, calendar, venue, incident, and score-evidence provenance | Implemented |
| `components/m2/ResourceRecommendation.tsx` | Quantities, rationale, versions, prototype status, and human override provenance | Implemented |

M1 owns `EventDetail.tsx`, and M3 owns `AuthorityEventReview.tsx`. They consume the reusable M2 presentation components without changing M2 semantics. M3 still owns the resource-adjustment controls and authority decision flow.

## Owned Backend and Data

- `functions/src/config/categorySchema.ts`
- `functions/src/engines/ruleBased.ts`
- `functions/src/engines/aiPredictor.ts`
- `functions/src/engines/resourceCalculator.ts`
- `functions/src/utils/weather.ts` and `functions/src/utils/holidays.ts`
- `functions/src/triggers/onEventCreated.ts` and M2 recompute behavior
- `events/{eventId}/assessments/{versionId}`
- `events/{eventId}/resources/{versionId}` baseline recommendation fields
- M2 assessment/resource audit entries
- M2 contracts in `shared/types.ts`

M3 owns authority resource overrides and the resulting human provenance even though the updated recommendation remains in the resource document.

## Active All-Hazards Contract v2

New assessments use `2026-07-24-all-hazards-v2`. Existing v1 documents remain readable and are never silently rewritten. The official result is deterministic; MiniMax remains advisory.

| Domain | Examples assessed |
|---|---|
| `crowd` | capacity pressure, density, ingress, egress, dispersal |
| `venue_fire` | fire/life safety, pyrotechnics, temporary structures |
| `weather_environment` | thunderstorm, wind, rain/flood, heat and exposure |
| `public_health` | communicable/vector-borne disease and vulnerable groups |
| `food_water_sanitation` | food, drinking water, toilets, waste |
| `medical_capacity` | onsite care, ambulance access, receiving hospital capacity |
| `security_cbrn` | behaviour, rivalry, deliberate threats and CBRN review |
| `transport_accessibility` | traffic, pedestrians and emergency access |

Each hazard uses HIRARC likelihood `1–5` × severity `1–5`. Residual matrix bands are Low `1–4`, Medium `5–12`, and High `15–25`. The overall official risk is the highest residual hazard, not an average that can hide one critical hazard. `officialScore` is retained for UI compatibility as `matrixScore × 4`.

Controls are `unknown`, `absent`, `declared`, or `verified`. Only verified controls reduce the residual likelihood or severity. The schema remains labelled `prototype` because authority validation is still required.

## Separate Readiness and Compliance Gates

Risk, evidence readiness, and legal/administrative compliance are separate:

- readiness is `complete`, `provisional`, or `insufficient_data`;
- compliance is `pass`, `review_required`, or `blocked`;
- an official risk number never converts a blocked capacity/fire check into a pass;
- event dates beyond the available weather horizon are provisional, not silently treated as normal weather;
- unmatched venue or unavailable weather evidence is insufficient data and requires review.

## Context and Historical Retrieval v2

Every assessment stores a context snapshot containing:

- weather source, freshness, forecast target, warning evidence, and timestamps;
- Malaysia local date, weekday, weekend flag, public-holiday/adjacent flag, and dataset version;
- submitted capacity plus verified safe capacity, fire-certificate status, emergency access and hospital travel time when available;
- completed eligible historical events from the same stable `venueId` within a 36-month pre-event lookback;
- comparable-event selection by venue, event type, environment, seating, attendance band and season;
- normalized patient presentation, hospital transfer, and incident rates with denominators;
- evidence source, quality, confidence, status and timestamp.

History is context evidence, not a direct “bad venue” score. Ineligible, rejected, under-review, post-event and future records are excluded. Synthetic history is explicitly labelled and receives low confidence.

## Locked MiniMax Contract v1

MiniMax M3 receives only allowlisted, non-PII event/context data and the immutable official result. It returns:

- advisory overall Low/Medium/High band;
- exactly one advisory analysis for every active category;
- evidence references, explanation, key concerns, and resource considerations;
- no numeric score, score adjustment, category mutation, resource quantity, or decision.

Invalid, unavailable, or timed-out AI output is stored as unavailable/invalid. The official score and deterministic resource quantities remain unchanged.

## Resource Contract v2

M2 calculates police, security, medical teams, ambulances, portable toilets, waste bins, and fire-safety officers from attendance, event type/environment, official risk, and category bands.

Every resource now stores a deterministic baseline, a prototype planning range, assumptions, applied risk modifiers, guideline references, reviewing authority, and an authority-review-required flag. Current ratios are internal prototype assumptions, not official WHO, PDRM, KKM, or BOMBA requirements.

M3 may override quantities during active review with a human rationale. An override does not alter the official risk result.

## Inputs From Other Modules

| Provider | M2 consumes |
|---|---|
| M1 | Immutable version, event characteristics, venue/location/capacity, schedule, attendance, and evidence paths |
| M4 | Assessment-eligible incident projection by stable venue ID |

Until M4 exists, `npm run seed:demo` provides deterministic emulator-only fixtures. They are never represented as real incidents. Unverified or assessment-ineligible incident reports never affect M2 scoring.

## Outputs To Other Modules

| Consumer | M2 provides |
|---|---|
| M1 | Assessment status and organiser-safe result/resource presentation data |
| M3 | Official category result, full provenance, AI advisory analysis, resource recommendation, and retry status |
| M5 | Official/advisory bands, schema versions, AI status, quantities, and resource override baseline |

## Demo Dataset and Local Testing

With Auth and Firestore emulators running:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_PROJECT_ID=linkos-496505 \
npm run seed:demo
```

The command refuses non-loopback emulator hosts and is idempotent. It creates 25 venues, 200 completed historical outcomes, 50 linked incidents, 12 application/assessment/resource examples, 6 demo accounts, and one provenance manifest. Organizer login is `organizer.demo@steras.local` / `Demo123!`; this credential exists only in the local emulator.

## Standards and Research Basis

- Malaysia DOSH, *Guidelines for Hazard Identification, Risk Assessment and Risk Control (HIRARC), 2008*: likelihood × severity and risk-control traceability.
- WHO, *Generic All-Hazards Risk Assessment Tool for Mass Gathering Events (2023)*: all-hazards identification, precautionary measures, preparedness and response capacity.
- Fire Services Act 1988, Part V: Fire Certificate applicability is a compliance check and designated-premises certificates are renewable annually.
- METMalaysia warning criteria: weather warnings are event-period evidence; thunderstorm warnings are short-horizon products and cannot justify a distant-event “clear weather” assumption.

The implementation metadata and source URLs live in `functions/src/config/standardsRegistry.ts`. These sources inform the method; they do not make the prototype an official government assessment tool.

## Remaining Work

- M4 must provide verified incident status, assessment eligibility, outcomes, and an after-action closeout contract.
- M1/M3 must decide who verifies declared controls and persist `verifiedControlIds` with reviewer provenance.
- Replace internal resource ratios only after PDRM, BOMBA, and KKM confirm authoritative local planning rules.
- Add a METMalaysia machine-readable warning adapter; OpenWeather remains contextual forecast data in the current implementation.
- Build a labelled expert-review evaluation set. Synthetic data may test behavior and retrieval, but cannot measure real-world accuracy.
- Re-run MiniMax live schema verification and deployed UAT after coordinated frontend/Functions deployment.

The monitoring pages detect legacy assessment/resource documents and label them as requiring recomputation rather than presenting old fields as current M2 results.

## Definition of Done

- Identical versioned input produces the same official categories, score, and level.
- Context and evidence provenance are complete and versioned.
- AI cannot change official outputs and fails safely within the timeout.
- Every resource has an integer quantity and traceable rationale.
- M1/M3 pages visibly distinguish official deterministic output from advisory AI.
- All M2 unit, integration, rules, build, and deployed UAT gates pass.
