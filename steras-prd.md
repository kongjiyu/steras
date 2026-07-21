---
project: STERAS - Smart Tourism Event Risk Assessment System
course: BMSE3004 Collaborative Development
version: 2.1
date: 2026-07-13
status: Architecture-aligned draft for team review
team_size: 5 members
tech_stack: React + Firebase + MiniMax M3
---

# STERAS - Product Requirements Document (PRD) v2.1

**For:** All five team members. This document is the implementation source of truth.

**TL;DR:** STERAS helps Malaysian authorities assess and approve tourism event permits using a layered hybrid architecture. A deterministic rule engine calculates an auditable baseline and sub-scores. MiniMax M3 consumes those outputs plus bounded, non-personal event context to explain the assessment and propose a limited upward adjustment. The server validates the result and exposes one final risk score with full provenance.

---

## 1. Product Overview

### Problem

Visit Malaysia 2026 targets 35.6 million tourist arrivals. More festivals, concerts, fairs, cultural events, and sporting events increase the workload for organizers and authorities. Current event risk and resource planning can rely on inconsistent manual judgement, incomplete context, and non-standard calculations.

STERAS addresses:

1. Inconsistent risk assessment between reviewers.
2. Manual resource calculations that are difficult to reproduce.
3. Limited use of weather, venue capacity, holidays, and incident history.
4. Weak auditability between submitted evidence, assessment, and decision.

### Product Scope

STERAS is a B2B/B2G web application that:

1. Lets organizers submit and track event applications.
2. Retrieves weather, holiday, venue, and incident context.
3. Calculates deterministic risk sub-scores and a baseline score.
4. Uses MiniMax M3 to explain the baseline and identify bounded compound-risk adjustments.
5. Recommends safety resources using transparent prototype formulas.
6. Lets assigned authorities approve, reject, or request amendments.
7. Publishes basic information about fully approved events.
8. Provides operational analytics from assessment and decision records.

### Non-Goals

- No ticketing, payments, bookings, or tourism itinerary planning.
- No crowd detection, image processing, IoT, or live sensor streams.
- No custom-trained machine-learning model.
- No direct integration with production PDRM, Bomba, KKM, MOTAC, or local-authority systems.
- No native mobile application or multi-language support for the MVP.

### SDG Alignment

- **SDG 8:** safer and better-planned work for event personnel.
- **SDG 11:** safer public events and cities.
- **SDG 12:** right-sized resources that reduce shortages and waste.

---

## 2. Users and Permissions

### Event Organizer

- Registers and signs in.
- Creates, edits, submits, withdraws, and resubmits owned applications.
- Can edit only while an application is `Draft` or `AmendmentRequested`; a submitted `Pending` version is immutable and may only be withdrawn.
- Views the latest assessment, resource recommendation, amendment request, and decision status for owned applications.
- Receives real-time in-app status updates. FCM push notifications are optional for the MVP.

### Authority Reviewer

- Belongs to one authority type: `PDRM`, `BOMBA`, `KKM`, `DBKL`, or `MOTAC`.
- Reads applications assigned to their authority type.
- Reviews the final risk score, baseline provenance, AI explanation, documents, and resources.
- Records `Approved`, `Rejected`, or `AmendmentRequested` with a mandatory rationale.
- Cannot edit organizer-submitted event data or overwrite audit records.

### Public Viewer

- Does not require authentication.
- Reads only fully approved records from `public_events`.
- Sees event name, type, venue, date, and approving authorities.
- Does not see contact details, uploaded documents, internal risk evidence, or audit logs.

---

## 3. Layered Risk Architecture

### Processing Sequence

```text
Validated event input
  -> contextual data retrieval
  -> deterministic rule-based assessment
  -> MiniMax M3 explanation and bounded adjustment proposal
  -> server-side validation
  -> final risk assessment
  -> deterministic resource recommendation
  -> immutable audit snapshot
```

The rule engine and AI do **not** run as independent competing scorers. The rule engine is the deterministic baseline. MiniMax M3 is an explanation and refinement layer. Authority users see one final score and can inspect how it was produced.

### Layer 1: Deterministic Baseline

Each raw sub-score is an integer from 0 to 100:

```text
baselineScore = round(
  0.30 * weatherScore
  + 0.25 * crowdScore
  + 0.20 * venueScore
  + 0.15 * historyScore
  + 0.10 * holidayScore
)
```

The system stores both raw sub-scores and weighted contributions. Every sub-score includes a short evidence description and source timestamp.

Risk levels are consistent across the product:

- `Low`: 0-39
- `Medium`: 40-69
- `High`: 70-100

### Layer 2: MiniMax M3 Refinement

MiniMax M3 receives:

- The five rule-based sub-scores and weighted contributions.
- The baseline score and risk level.
- Non-personal event context required to explain compound risk: event type, attendance, capacity utilization, indoor/outdoor status, coverage, duration, weather summary, holiday proximity, and anonymized incident summary.
- Curated standard identifiers and descriptions supplied by the server.

It must not receive organizer contact details, uploaded documents, user IDs, or unrelated free-text personal data.

The AI returns structured JSON:

```json
{
  "proposedAdjustment": 0,
  "reasoning": "Explanation tied to named sub-scores and evidence.",
  "compoundEffects": ["weather_and_outdoor_crowd"],
  "keyConcerns": ["thunderstorm", "near_capacity"],
  "citedEvidenceKeys": ["weather", "crowd", "venue"]
}
```

`proposedAdjustment` must be an integer from 0 to 15. The server, not the model, calculates:

```text
validatedAdjustment = clamp(proposedAdjustment, 0, 15)
finalScore = clamp(baselineScore + validatedAdjustment, baselineScore, 100)
finalRiskLevel = levelFor(finalScore)
```

If the output is invalid, references missing evidence, times out, or the API is unavailable, `validatedAdjustment` becomes `0`; the baseline remains the final score and the record is marked `aiStatus: unavailable | invalid`.

### MiniMax Integration Contract

- Target model: `MiniMax-M3`.
- M3 was officially released on 1 June 2026 and is available through MiniMax API services.
- The deployed model ID is configured through `MINIMAX_MODEL`, not hardcoded across the codebase.
- The deployment process must verify the configured ID using MiniMax's Models API because product announcements and compatibility documentation may update at different times.
- API credentials must be stored in Firebase Secrets / Google Secret Manager, never in the frontend or repository.
- Prompt version, model ID, request timestamp, validated input hash, parsed output, and validation result are logged for audit. Hidden model reasoning is not required or stored.

Official source: https://www.minimax.io/blog/minimax-m3

---

## 4. Functional Modules

### Module 1: Event Management

**Owner:** Requirement Lead

Organizer capabilities:

- Create and save a draft application.
- Submit a complete application.
- Edit or withdraw an application while permitted by its status.
- Respond to amendment requests and resubmit.
- Track authority decisions in real time.
- Upload PDF or image evidence up to 10 MB per file.

Required event fields:

| Field | Type |
|---|---|
| Event name and type | text + enum |
| Venue name and address | text |
| Coordinates | lat/lng; required before assessment |
| Venue capacity | positive integer |
| Expected attendance | positive integer, not above declared capacity without warning |
| Environment | indoor / outdoor / mixed |
| Coverage | covered / partially covered / uncovered |
| Seating | seated / standing / mixed |
| Start and end datetime | valid future range |
| Event description | optional, maximum 2,000 characters |
| Organizer name, email, phone | required, private |
| Emergency-plan summary | required, maximum 2,000 characters |

Submitting or resubmitting creates a new immutable assessment version. Previous assessments remain available to authorities for audit.

### Module 2: Smart Risk Assessment

**Owner:** Programmer

Inputs:

- Validated event fields from Module 1.
- OpenWeather forecast and retrieval timestamp.
- Malaysian public-holiday proximity.
- Venue capacity and synthetic incident history.
- Curated rule and standard version.

Outputs:

- Baseline score, level, five sub-scores, weighted contributions, and evidence.
- AI adjustment, explanation, key concerns, compound effects, and status.
- Final score and level.
- Assessment version, timestamps, prompt version, and data-source freshness.

The pipeline is idempotent for an assessment version. Duplicate triggers must not create multiple active assessments.

### Module 3: Safety Resource Recommendation

**Owner:** Design Lead, supported by Programmer

Resource calculations use the validated **final risk level** and attendance. For the MVP, all formulas are explicitly labelled **prototype heuristics pending authority validation**.

| Resource | Prototype Formula |
|---|---|
| Police officers | `max(2, ceil(attendance / 250)) + 10 if High` |
| Medical teams | `max(1, ceil(attendance / 1000)) + 1 if High` |
| Ambulances | `max(1, ceil(attendance / 5000))` |
| Portable toilets | `ceil(attendance / 50) + ceil(attendance / 75)` |
| Waste bins | `ceil(attendance / 100)` |
| Security | `ceil(attendance / 100) * eventTypeMultiplier` |
| Fire officers | `max(1, ceil(attendance / 500)) + 1 if indoor` |

Requirements:

- Store formula version, inputs, output, and confidence `prototype` or `authorityValidated`.
- Show source notes without claiming an unverified formula is an official WHO/PDRM/Bomba requirement.
- AI may explain resource implications but cannot automatically override deterministic quantities.
- An authority override requires a quantity, rationale, reviewer ID, timestamp, and previous value.

### Module 4: Authority Review and Approval

**Owner:** Programmer, supported by Design Lead and Tester

The review workspace provides:

- Real-time assigned application queue.
- Search by event or organizer.
- Filters for authority, status, risk level, event type, and date.
- Event details, private organizer details, submitted evidence, and version history.
- Final risk score as the primary value.
- Expandable baseline, sub-scores, weighted contributions, AI adjustment, and cited evidence.
- Resource recommendation and any authority overrides.
- Approve, Reject, and Request Amendment actions with mandatory rationale.

#### Multi-Authority Decision Rule

Each application stores `requiredAuthorities`, configured from event type and location for the prototype dataset.

- Each required authority has one current decision per application version.
- Any `Rejected` decision makes the application `Rejected`.
- Any `AmendmentRequested` decision makes it `AmendmentRequested` and blocks remaining approval.
- The application becomes `Approved` only when every required authority has approved the same assessment version.
- Resubmission invalidates prior approvals for the changed version and starts a new review cycle.
- A transaction or server function prevents conflicting concurrent decisions.

### Module 5: Analytics and Reporting

**Owner:** Tester, supported by Programmer

MVP analytics include at least three charts:

- Applications and approvals by month.
- Final risk-level distribution.
- Average baseline score versus final score over time.

Additional analytics:

- Average and distribution of validated AI adjustments.
- AI fallback/invalid-output rate.
- Event types and venues associated with high final risk.
- Recommended resources by event type.
- Approval turnaround time by authority.
- CSV export; PDF export is optional.

Analytics must never expose organizer contact details or document content.

---

## 5. Application State Machine

```text
Draft
  -> Pending
  -> UnderReview
       |-> Approved
       |-> Rejected
       `-> AmendmentRequested
             `-> Pending (resubmitted as a new version)

Draft | Pending -> Withdrawn
```

Rules:

- Only organizers create drafts and submit owned applications.
- `Pending` begins assessment processing.
- `UnderReview` begins when the first assigned authority opens or claims the current version.
- Authority decisions are server-mediated and append-only.
- Approved records are copied to `public_events` only after all required approvals.
- Failed AI processing does not block review; the baseline score is used with a visible warning.

---

## 6. Key User Flows

### Organizer Submission

1. Organizer creates and validates an application.
2. Submission creates application version 1 with status `Pending`.
3. Server retrieves contextual data and computes the baseline.
4. MiniMax M3 proposes a bounded adjustment and explanation.
5. Server validates and stores the final assessment and resources.
6. Organizer sees processing status and then the final result summary.
7. Assigned authorities receive the application in real time.

### Authority Review

1. Reviewer opens an assigned application version.
2. Reviewer sees the final score, explanation, and provenance.
3. Reviewer verifies event documents and resources.
4. Reviewer approves, rejects, or requests amendment with rationale.
5. Server writes the decision and immutable audit record in one transaction.
6. Overall status is recomputed from all required-authority decisions.
7. Organizer receives an in-app update; optional FCM is sent when configured.

### Amendment and Resubmission

1. Organizer reads authority-specific amendment reasons.
2. Organizer changes permitted fields and resubmits.
3. The system creates a new application version and assessment version.
4. Previous decisions remain visible but no longer count toward approval.

### Public Event View

1. Public viewer opens the approved-events calendar.
2. The page reads only from `public_events`.
3. Viewer sees non-sensitive event details and approving authorities.

---

## 7. Data Sources

### External

- MiniMax M3 API for bounded explanation and refinement.
- OpenWeather API for scheduled forecast context.
- Static versioned Malaysian public-holiday data.

### Synthetic Prototype Data

- 20-30 Malaysian venues.
- Venue and event-type incident history clearly labelled synthetic.
- Required-authority mappings for demo event types and locations.

### Manual and Curated

- Organizer event input and documents.
- Authority decisions and resource overrides.
- Versioned scoring rules and standard notes reviewed by the team.

---

## 8. Firestore Data Model

```text
users/{uid}
events/{eventId}
events/{eventId}/versions/{versionId}
events/{eventId}/assessments/{assessmentId}
events/{eventId}/resources/{resourceId}
events/{eventId}/decisions/{decisionId}
events/{eventId}/audit_logs/{auditId}
venues/{venueId}
incidents/{incidentId}
public_events/{eventId}
```

### Risk Assessment Contract

```text
RiskAssessment {
  eventId, versionId, assessmentId,
  ruleVersion,
  subScores: { weather, crowd, venue, history, holiday },
  weightedContributions,
  baselineScore, baselineRiskLevel,
  ai: { model, promptVersion, status, proposedAdjustment,
        validatedAdjustment, reasoning, compoundEffects,
        keyConcerns, citedEvidenceKeys },
  finalScore, finalRiskLevel,
  sourceTimestamps,
  inputHash,
  createdAt
}
```

### Access Control

- Organizer: own profile, owned events, and permitted versions only.
- Authority: applications assigned to their authority type and their supporting records.
- Public: `public_events` only.
- Assessments, decisions, resources, audit logs, roles, and publication records are server-written.
- Audit logs are append-only and cannot be updated or deleted by clients.

---

## 9. Technology Stack

### Frontend

- React 18, Vite, TypeScript, Tailwind CSS.
- Firebase JS SDK and `react-firebase-hooks`.
- Chart.js for analytics.

### Backend

- Firebase Authentication.
- Cloud Functions for Firebase using Node.js 22.
- Firestore, Cloud Storage, and optional Firebase Cloud Messaging.
- Firebase Emulator Suite for local integration testing.

### AI and External APIs

- MiniMax M3, model ID configured by environment and verified during deployment.
- MiniMax standard API or a compatibility endpoint that explicitly lists M3 at integration time.
- OpenWeather forecast API.
- Server-side secrets through Firebase Secrets / Google Secret Manager.

---

## 10. Security, Privacy, and Reliability

- Do not send PII, contact details, uploaded files, or user IDs to MiniMax.
- Validate and length-limit all free-text fields before storage and AI use.
- Validate AI JSON against a strict schema; never trust model-calculated final scores.
- Set AI timeout, retry, and rate limits. Maximum one automatic retry per assessment version.
- Cache weather by coordinates and forecast window; cache AI by input hash and prompt version.
- Record data-source timestamps and show stale-data warnings.
- Store secrets only in server-side secret management.
- Define and document retention for applications, documents, AI records, and audit logs before deployment.
- Test Firestore and Storage rules with Firebase Emulator Suite.

---

## 11. MVP Acceptance Criteria

- Organizer can register, sign in, submit a valid event, and see status without refreshing.
- Invalid capacity, date, coordinates, or required fields are rejected with clear messages.
- One submission creates exactly one active assessment version despite duplicate triggers.
- Baseline calculation is deterministic for identical inputs and rule version.
- Final score is always between the baseline and `min(baseline + 15, 100)`.
- AI failure produces a usable baseline assessment within 15 seconds and shows a warning.
- Successful external assessment completes within 60 seconds for the demo environment.
- Authority can inspect provenance and record one rationale-backed decision.
- Concurrent or duplicate authority actions do not produce conflicting current decisions.
- Overall approval requires all configured authorities for the same version.
- Resubmission creates a new version and invalidates prior approvals without deleting history.
- Every assessment, resource override, and decision creates an audit record.
- Public users cannot read private events, contacts, assessments, documents, or audit logs.
- Analytics provides at least three charts without exposing PII.
- Core flows work on current Chrome, Edge, and Safari at desktop and 390px mobile width.

### Nice-to-Have

- FCM push notification after decisions.
- PDF analytics export.
- Google Places address and coordinates assistance.

---

## 12. Build Order and Ownership

1. **Module 1:** input schema, event versions, authentication, and Firestore rules.
2. **Module 2:** deterministic scoring, MiniMax refinement, validation, and audit.
3. **Module 3:** resource formulas, versioning, and override workflow.
4. **Module 4:** real-time queue, provenance UI, decisions, and multi-authority status.
5. **Module 5:** analytics based on stable assessment and decision records.

| Module | Lead | Support |
|---|---|---|
| Event Management | Requirement Lead | Project Manager |
| Smart Risk Assessment | Programmer | Design Lead |
| Resource Recommendation | Design Lead | Programmer |
| Authority Review | Programmer | Design Lead, Tester |
| Analytics | Tester | Programmer |

---

## 13. Timeline

| Week | Deliverable |
|---|---|
| 3 | Proposal presentation |
| 4-5 | Modules 1-2 vertical slice |
| 6-7 | Modules 3-4 and emulator integration |
| 8 | Checkpoint 1 and architecture review |
| 9-10 | Module 5 and cross-browser testing |
| 11-12 | Security-rule tests, bug fixes, documentation, demo data |
| 13 | Project demo |
| 14 | Final assessment documentation due 17 Sep 2026, 11:59 PM |

---

## 14. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| MiniMax API or model-ID change | Environment-configured model; deployment-time Models API check; baseline fallback |
| Invalid or hallucinated AI output | Strict schema, evidence-key validation, 0-15 server clamp |
| Weather/API downtime | Cached context, source timestamps, deterministic fallback |
| Duplicate Firestore triggers | Input hash, version idempotency key, transactional active record |
| Concurrent authority decisions | Server transaction and one current decision per authority/version |
| Unverified resource ratios | Label as prototype; version formulas; require authority validation |
| Firebase quota or cost overrun | Caching, rate limits, budget alerts, emulator-first testing |
| Privacy leakage to external AI | Explicit allowlist of non-PII AI fields and audit of request payload |

---

## 15. References and Design Sources

1. Tourism Malaysia. *Launch of Visit Malaysia 2026 Campaign: A Milestone for Tourism Growth.* https://www.tourism.gov.my/index.php/media/view/launch-of-visit-malaysia-2026-campaign-a-milestone-for-tourism-growth
2. World Health Organization. *Managing health risks during mass gatherings.* https://www.who.int/activities/managing-health-risks-during-mass-gatherings
3. Revello, A., & Marzio, A. (2011). *Mass-Gathering Event Risk Scoring Model: A Score to Predict Risk Level and Medical Usage Rate during Metropolitan Mass Gatherings.* Prehospital and Disaster Medicine, 26(S1), s76. https://doi.org/10.1017/S1049023X11002585
4. Khalid, S., et al. (2022). *Crowd risk prediction in a spiritually motivated crowd.* Safety Science, 154, 105857. https://doi.org/10.1016/j.ssci.2022.105857
5. Tsai, S. (2026). *Behavior Rule Architecture: Rule-Based Governance of AI System Behavior.* Engineering Archive. https://doi.org/10.31224/6681. Used as an AI-governance analogy, not as an event-risk scoring standard.
6. MiniMax. *MiniMax M3: Frontier Coding, 1M Context, Native Multimodality - All in One Model.* https://www.minimax.io/blog/minimax-m3
7. Firebase. *Get started with Cloud Functions for Firebase.* https://firebase.google.com/docs/functions/get-started
8. OpenWeather. *One Call API 3.0.* https://openweathermap.org/api/one-call-3

---

## 16. Open Decisions Before Module 3 Sign-Off

1. Obtain authority or lecturer validation for each resource formula and source note.
2. Finalize the event-type/location mapping to `requiredAuthorities` for the demo dataset.
3. Confirm the exact M3 API model ID and endpoint using the team's MiniMax account and Models API.
4. Approve the 20-30 event synthetic dataset and document its generation assumptions.
5. Decide whether FCM remains optional after the core real-time in-app flow is complete.

---

**Next implementation milestone:** complete one emulator-tested vertical slice from organizer submission through deterministic baseline, validated MiniMax M3 refinement, resource recommendation, and one authority decision.
