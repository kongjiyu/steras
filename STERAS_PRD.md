---
title: STERAS — Product Requirements Document
course: BMSE3004 Collaborative Development
project: Smart Tourism Event Risk Assessment System
version: 3.1
status: Final-source aligned draft
date: 2026-07-21
source_of_truth:
  - source/STERAS_Updated_Project_Proposal_2026-07-21.docx
  - assets/steras-category-based-workflow-2026-07-21.jpeg
  - Team clarification on 2026-07-21: category-based terminology supersedes residual legacy assessment wording
---

# STERAS — Product Requirements Document

## 1. Product purpose

**Smart Tourism Event Risk Assessment System (STERAS)** is a web-based decision-support system for Malaysian authorities that review tourism-event safety applications. It supports event organisers to submit applications and supporting evidence; retrieves relevant context; produces a structured, explainable risk assessment and safety-resource recommendation; and gives authorised officers the information needed to approve, reject, or request revisions.

STERAS supports, but never replaces, human authority decisions. It does not automatically approve or reject an event.

## 2. Source-of-truth scope

This PRD implements the group-provided updated proposal, category-based workflow diagram, and the team's terminology clarification dated 21 July 2026. The workflow contains five application-to-decision stages plus a post-decision complaint-handling stage:

1. **Event application submission**
2. **Contextual data collection**
3. **Category-based, AI-assisted assessment**
4. **Safety resource recommendation**
5. **Multi-level review and final authority decision**
6. **User complaint handling**

The five main delivery modules remain: User & Event Management; Smart Risk Assessment and Safety Resource Recommendation; Authority Approval; Incident Reporting; and Analytics & Reporting. Complaint handling is delivered within the Incident Reporting and Authority Approval workflows rather than treated as a sixth separately owned module.

### 2.1 Source reconciliation decision

The updated proposal and workflow still contain isolated legacy assessment phrases and analytics labels. The team has explicitly confirmed **category-based assessment** as the current approach. In this PRD, all residual legacy assessment wording is interpreted as follows:

- the official assessment is produced by deterministic **category profile and scoring logic**;
- MiniMax M3 provides advisory category analysis, explanations, and contextual recommendation support;
- the legacy baseline-agreement metric is renamed **AI vs Deterministic Category Agreement Rate**; and
- the category-based assessment never makes the authority's final approval decision.

This interpretation preserves transparent, repeatable scoring while making the terminology and workflow consistently category-based.

### 2.2 Confirmed module scope

| Module | Confirmed scope |
|---|---|
| User & Event Management | User registration and login; event application submission; event information management; supporting-document upload; edit or withdrawal of pending applications; and real-time application-status tracking. |
| Smart Risk Assessment and Safety Resource Recommendation | Analyse application data with weather forecasts, public holidays, venue history/capacity, day of week, attendance, and historical incidents; produce the deterministic category-based risk profile, score, and level; use MiniMax M3 for category explanations and contextual safety insights; and recommend police officers, medical teams, ambulances, portable toilets, waste bins, security personnel, and fire-safety officers using event characteristics and WHO/PDRM/Bomba guidance. |
| Incident Reporting | Allow organisers and relevant authorities to report during-event or post-event incidents with details, location, time, evidence, and severity; retain incident records for post-event review, future assessment context, and continuous safety improvement. |
| Authority Approval | Review applications, category-based risk profiles, AI-generated explanations, and safety-resource recommendations; approve, reject, or request revision; monitor progress; and notify organisers of Pending, Approved, Rejected, or Revision Requested outcomes in real time. |
| Analytics & Reporting | Display event-submission statistics, risk distribution, resource-recommendation trends, approval performance, resource utilisation, incidents, review performance, re-applications, and complaint trends for data-driven decision-making. |

## 3. Architecture and decision boundary

### 3.1 Core assessment contract

STERAS uses a **category-based, AI-assisted assessment**. Deterministic category profile and scoring logic produces the official risk result; MiniMax M3 is an advisory AI-assistance layer.

| Component | Responsibility | Cannot do |
|---|---|---|
| Category profile and scoring logic | Categorise the event from validated data, apply configured category profiles, scoring criteria, and guideline checks, calculate the official score, and classify the official risk level. | Approve, reject, contact the organiser, or delegate its calculation to AI. |
| MiniMax M3 category analysis | Analyse the event, contextual evidence, and deterministic category result; produce category-level explanations; identify contextual safety insights; and explain or suggest category-specific resources in structured JSON. | Replace the official deterministic score/risk level, silently change a category assignment, or make the final decision. |
| Resource recommendation logic and guidelines | Calculate baseline indicative quantities for safety resources using the official risk level, category profile, event characteristics, and WHO/PDRM/Bomba guidance. | Treat a recommendation as an approval or confirmed resource deployment. |
| Firebase Cloud Functions | Retrieve context, invoke scoring/AI workflows, validate structured responses, persist results, and enforce auditability. | Bypass authority review. |
| Authority officer | Review the complete assessment and decide to approve, reject, or request revision. | Delegate final responsibility to AI. |

### 3.2 Assessment sequence

1. Cloud Functions validates the submitted event application and supporting documents.
2. The system retrieves contextual evidence: weather forecast, public-holiday information, venue-capacity information, day of week, and historical incident records.
3. The deterministic category engine assigns the event to the applicable risk categories, performs category profile scoring and guideline checks, and calculates the **official category-based score** and **official Low/Medium/High risk level**.
4. MiniMax M3 receives the validated event data, contextual evidence, relevant standards, and deterministic category result. It returns a structured **advisory** analysis for each assessment category, explaining the evidence, contextual effects, and category-specific safety considerations. It may return advisory category labels or bands for explainability and agreement analytics, but not an authoritative replacement score.
5. The system produces a consolidated category-based risk profile containing the official score and level, final category assignment, AI explanation, and recommended safety resources.
6. Baseline resource quantities are calculated using configured category-to-resource mappings and guideline criteria. MiniMax M3 may explain the baseline and suggest contextual considerations, but it does not authorise quantities, deployment, or the approval outcome.
7. An authority officer completes the final decision workflow.

### 3.3 Category schema

The detailed category taxonomy, category criteria, scoring weights, profile thresholds, resource mappings, and Low/Medium/High boundaries are configuration owned by the team and must be versioned before implementation. This PRD intentionally does not lock individual category names.

All assessments must preserve the category-schema version, scoring-logic version, guideline version, context snapshot, official category-based result, AI response, and authority decision in the audit record.

### 3.4 AI failure and disagreement handling

- If MiniMax M3 is unavailable, invalid, or returns non-conforming JSON, the official deterministic category-based score remains available; the application is marked **AI explanation unavailable** and may be retried or reviewed manually.
- If advisory AI analysis differs from the deterministic result, the system records the difference for review and analytics. It must not automatically change the official score, risk level, resource quantity, or decision.
- The dashboard must visibly label AI analysis as **advisory** and the deterministic category-based score as **official assessment result**.

## 4. Users and access rights

| User | Primary tasks | Access boundary |
|---|---|---|
| Event organiser | Register, submit and manage own event applications, upload documents, view status, answer revision requests, report incidents, and submit complaints. | Can view only own applications, related decisions, notifications, incidents, and complaint tickets. |
| Authority officer / initial admin | Review applications, assessments, recommendations, incidents, complaints, and decision history. | May act only within assigned authority scope. |
| Multi-department reviewer | Provide logistics/safety review input before a final decision. | Cannot make the final authority decision unless granted that role. |
| Final authority officer | Approve, reject, or request revision and record a justification. | Retains final responsibility. |
| Public viewer | View approved events through a read-only calendar. | Cannot access applications, risk results, organiser data, incidents, or complaints. |

## 5. Functional requirements

### M1 — User and Event Management

| ID | Requirement |
|---|---|
| FR-01 | The system shall support organiser registration, login, logout, and role-based access through Firebase Authentication. |
| FR-02 | The system shall allow organisers to submit an event application containing event type, venue, expected attendance, date and duration, organiser details, and supporting documents. |
| FR-03 | The system shall store supporting documents securely in Firebase Cloud Storage and associate them with the application record. |
| FR-04 | The system shall allow an organiser to edit or withdraw an application while it remains pending. |
| FR-05 | The system shall show real-time application status: Pending, Under Review, Revision Requested, Approved, Rejected, or Withdrawn. |
| FR-06 | The system shall provide a read-only public calendar of approved events without exposing personal or assessment data. |

The four organiser-facing authority outcomes are **Pending, Approved, Rejected, and Revision Requested**. **Under Review** is an internal progress state, while **Withdrawn** records an organiser action available only before a pending application has received a final outcome.

### M2 — Smart Risk Assessment and Safety Resource Recommendation

| ID | Requirement |
|---|---|
| FR-07 | The system shall retrieve and store contextual evidence relevant to the application: weather forecast, public-holiday information, venue-capacity information, day of week, and historical incident records. |
| FR-08 | The system shall apply the active category schema, category profiles, deterministic scoring logic, and guideline checks to calculate an official numeric category-based score and Low/Medium/High risk level. |
| FR-09 | The system shall retain each category assignment, category contribution, scoring result, schema version, scoring-logic version, and evidence reference used in the official assessment. |
| FR-10 | The system shall call MiniMax M3 through the Anthropic-compatible API using validated event data, contextual evidence, relevant WHO/PDRM/Bomba guidance, and the official deterministic category result. |
| FR-11 | MiniMax M3 output shall contain structured advisory category analysis, evidence references, natural-language explanation, key concerns, and contextual resource-recommendation explanation. |
| FR-12 | The system shall validate MiniMax M3 JSON against the expected schema and label the response advisory. Invalid or unavailable AI output must not replace the official deterministic category result. |
| FR-13 | The system shall generate baseline indicative quantities for police officers, security personnel, medical teams, ambulances, portable toilets, waste bins, and fire-safety officers using configured category-to-resource mappings, guideline criteria, the official risk level, and event characteristics. MiniMax M3 may explain the recommendation and suggest contextual considerations for authority review. |
| FR-14 | The system shall present one consolidated risk profile: official score, official risk level, category assignment, AI explanation, recommendations, and source evidence. |
| FR-15 | The system shall support an explainable risk view that identifies why each category and the overall result were produced. |

### M3 — Authority Approval and Notification

| ID | Requirement |
|---|---|
| FR-16 | The system shall provide an authority dashboard for reviewing complete application data, supporting documents, the official category-based score and profile, AI advisory explanation, resource recommendation, and audit history. |
| FR-17 | The system shall support an initial admin review followed by multi-department logistics/safety review before final authority decision when the workflow requires it. |
| FR-18 | The final authority officer shall be able to Approve, Reject, or Request Revision and must record a free-text justification. |
| FR-19 | The system shall generate an AI-assisted rejection reason and revision suggestion for an authorised officer to review and edit before it is sent. |
| FR-20 | The system shall allow an organiser to update and re-submit an application after a revision request or rejection where re-application is permitted. |
| FR-21 | The system shall send real-time in-app and push notifications for review progress, multi-department review, decision changes, revision requests, complaint updates, and re-application status. |
| FR-22 | The system shall record every decision with timestamp, authority user ID, decision, justification, and the assessment version reviewed. |

### M4 — Incident Reporting and User Complaint Handling

| ID | Requirement |
|---|---|
| FR-23 | The system shall allow organisers and authorised personnel to report incidents during or after an event, including details, location, time, severity, and supporting evidence. |
| FR-24 | The system shall track incident status and retain records for post-event review and future risk-assessment context. |
| FR-25 | The system shall allow a user to submit a complaint with details and linked application/event information. |
| FR-26 | An admin shall be able to review a complaint, open a ticket for the relevant event organiser, and track the investigation/update status. |
| FR-27 | The system shall notify the complainant when a material complaint update or final response is available. |

### M5 — Analytics and Reporting

| ID | Requirement |
|---|---|
| FR-28 | The analytics dashboard shall display submission trends, risk-profile distribution, recommendation/resource trends, approval performance, and historical-incident statistics. |
| FR-29 | The dashboard shall display manual override or authority-decision outcome trends without implying that AI makes final decisions. |
| FR-30 | The dashboard shall display **AI vs Deterministic Category Agreement Rate** and **AI vs Final Category Agreement Rate** as quality-monitoring metrics only. These metrics compare advisory AI category classifications with deterministic and final recorded category outputs; they must not alter the official result. |
| FR-31 | The dashboard shall display re-application rate, initial-review status, multi-department-review agreement rate, and user complaint trends. |
| FR-32 | Authorised users shall be able to filter analytics by date range, event type, venue, risk level, application status, and relevant authority scope. |
| FR-33 | The system shall retain analytics source data and calculation definitions so displayed metrics are auditable. |

## 6. Data and integration requirements

### 6.1 Technology baseline

| Layer | Selected technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, Chart.js, Firebase JavaScript SDK |
| Backend | Firebase Cloud Functions on Node.js 18 |
| Authentication | Firebase Authentication |
| Database | Firebase Firestore |
| File storage | Firebase Cloud Storage |
| AI service | MiniMax M3 via `https://api.minimax.io/anthropic` and `@anthropic-ai/sdk` |
| Context API | OpenWeather API; maintained Malaysian public-holiday dataset; historical Firestore records |
| Development tools | Git/GitHub, VS Code, Firebase Emulator Suite, Postman |

### 6.2 Core Firestore collections

| Collection | Purpose |
|---|---|
| `users` | Role, profile, authority scope, and account status. |
| `events` | Event applications, organiser data, workflow status, and supporting-document references. |
| `assessments` | Official category-based score and profile, category outputs, AI advisory output, resource recommendation, versions, and audit data. |
| `incidents` | Incident reports, evidence, severity, and follow-up status. |
| `complaints` | User complaints, assigned ticket, investigation updates, and user feedback. |
| `decisions` | Authority review actions, justifications, timestamps, and assessment version reviewed. |
| `notifications` | Status-change, review, complaint, and re-application notifications. |
| `analyticsSnapshots` | Auditable aggregates and metric definitions. |

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | Access shall be role based. Organisers can access only their own data; the public can access only approved public-calendar information. |
| NFR-02 | Supporting documents, assessment evidence, AI responses, deterministic category results, and authority decisions shall be access controlled and auditable. |
| NFR-03 | Every official assessment shall be explainable through category assignment, category contributions, context evidence, scoring criteria, and resource-guideline logic. |
| NFR-04 | AI output shall be structured JSON, schema validated, persisted with prompt/schema versions, and presented as advisory. |
| NFR-05 | The system shall remain operational for official deterministic scoring when the AI explanation service is unavailable. |
| NFR-06 | The system shall not make an automatic approval, rejection, or final resource-authorisation decision. |
| NFR-07 | Any synthetic data used for prototype testing shall be clearly labelled as academic test data and not official government records. |
| NFR-08 | The system shall collect only data required for assessment and workflow purposes and apply secure handling consistent with PDPA-aware design. |
| NFR-09 | Firestore-backed status changes and notifications shall update without manual refresh for connected users. |
| NFR-10 | Category schemas, scoring logic, guideline criteria, score boundaries, AI prompts, and analytics definitions shall be versioned. |

## 8. Acceptance criteria

| Scenario | Pass condition |
|---|---|
| Valid application | Organiser can submit an event and documents; event enters Pending status. |
| Assessment | System retrieves and records context, assigns the event to applicable categories, produces a deterministic category-based score and risk level, and stores an explainable profile. |
| AI assistance | MiniMax M3 response is schema-valid, visibly advisory, and explains the official assessment without replacing it. |
| AI failure | Official score is retained; AI explanation is marked unavailable/retryable; no fabricated fallback or automatic decision occurs. |
| Resource recommendation | Required resource types and indicative quantities are shown with guideline-based rationale. |
| Review | Initial and multi-department reviewers can record review input; final authority can approve, reject, or request revision with justification. |
| Re-application | Organiser receives a revision/rejection notice, updates the application, and re-submits through the controlled loop. |
| Incident and complaint | An incident or complaint can be submitted, reviewed, ticketed, updated, and communicated to the affected user. |
| Analytics | Dashboard shows the final workflow metrics, including agreement metrics as monitoring-only information. |
| Privacy | Organiser cannot view another organiser's event, assessment, incident, or complaint data. |

## 9. Out of scope for the prototype

- Automatic government approval or rejection.
- Real-time crowd surveillance, CCTV analytics, IoT sensors, or facial recognition.
- Direct access to confidential authority databases.
- A custom-trained machine-learning model.
- Guaranteed real-world resource deployment or emergency-service dispatch.
- Public disclosure of risk scores, incident details, complaints, or personal organiser information.

## 10. Release priorities

### Must have

- Authentication, organiser event submission, document upload, contextual-data capture, deterministic category profiling and scoring, MiniMax M3 category analysis and explanation, resource recommendation, authority review, notifications, audit trail, and basic analytics.

### Should have

- Multi-department review, incident reporting, complaint tickets, re-application loop, public approved-event calendar, and analytics filters.

### Could have

- CSV/PDF report export, richer trend visualisations, enhanced comparison of similar historical events, and configurable dashboard widgets.

## 11. Traceability to final sources

| Final source element | PRD implementation |
|---|---|
| Online event application | FR-01 to FR-06 |
| Weather, holiday, capacity, weekday, and incident context | FR-07; assessment sequence §3.2 |
| Category-based profile, score, and level | §3.1–3.4; FR-08 and FR-09 |
| AI analysis, explanation, and recommendation; AI does not decide | §3.1, §3.4; FR-10 to FR-12 |
| Consolidated risk profile | FR-14 and FR-15 |
| Police, security, medical, ambulance, toilet, waste, and fire resources | FR-13 |
| Initial review, multi-department review, final decision, rejection/re-application loop | FR-16 to FR-22 |
| Notifications | FR-21 |
| During-event and post-event incident reporting | FR-23 and FR-24 |
| Complaint handling | FR-25 to FR-27 |
| Analytics and agreement metrics | FR-28 to FR-33 |

---

**Architecture decision:** The deterministic category-based score and profile are the official assessment result. MiniMax M3 provides advisory category analysis, explanations, and contextual recommendation support; an authorised human officer remains the final decision-maker.
