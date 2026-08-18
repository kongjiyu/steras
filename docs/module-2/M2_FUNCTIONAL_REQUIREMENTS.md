# M2 — Smart Risk Assessment and Safety Resource Recommendation

The module owns contextual evidence retrieval, deterministic risk assessment,
advisory AI analysis, safety-resource planning, and assessment outputs for
other modules.

> Status: Team-confirmed functional requirements supplied on 2026-08-08. These
> requirements are the source of truth for the current Module 2 documentation
> set and are not derived from `STERAS_PRD.md`.

| ID | Functional Requirement |
|---|---|
| FR-M2-01 | The system shall retrieve weather, public-holiday, venue, calendar, historical-event outcome, and verified assessment-eligible incident information relevant to the submitted event application. |
| FR-M2-02 | The system shall record the source, retrieval time, eligibility, synthetic-data indicator, and other provenance details for each contextual evidence item used in an assessment. |
| FR-M2-03 | The system shall validate whether the submitted event application contains sufficient evidence and required information before determining its assessment readiness, compliance status, and evidence-confidence level. |
| FR-M2-04 | The system shall send validated event data, contextual evidence, the active category rubric, configured hard rules, and relevant guidance to MiniMax M3 for structured hazard identification and category assessment. |
| FR-M2-05 | MiniMax M3 shall identify relevant hazards and propose a likelihood score, severity score, evidence references, rationale, confidence level, concerns, and missing-information indicators for each applicable assessment category. |
| FR-M2-06 | The system shall validate the MiniMax response against the required JSON schema, permitted categories, scoring ranges, available evidence references, configured hard rules, and the active assessment rubric. |
| FR-M2-07 | The system shall apply configured hard-rule constraints and deterministically calculate each category risk value and the overall risk result from the validated likelihood and severity scores using the active scoring formula, weights, thresholds, and guideline checks. |
| FR-M2-08 | The system shall record validation warnings for missing evidence, unsupported evidence references, invalid calculations, rubric conflicts, low-confidence outputs, and material differences between AI-proposed scores and hard-rule constraints, and shall mark affected assessments for authority review. |
| FR-M2-09 | The system shall retain the event input, contextual evidence, AI-identified hazards, AI-proposed category scores, evidence references, rationale, confidence indicators, validation results, hard-rule adjustments, calculated risk results, rubric version, prompt version, model identifier, and authority confirmation or override as an auditable assessment record. |
| FR-M2-10 | When MiniMax M3 is unavailable, times out, or returns invalid output, the system shall mark the AI-assisted assessment as unavailable or retryable and shall allow the assessment to proceed through an authorised manual-review process without fabricating category scores. |
| FR-M2-11 | The system shall generate baseline quantities and planning ranges for police, security, medical, ambulance, sanitation, waste-management, and fire-safety resources using the validated risk result, event characteristics, configured assumptions, and relevant guidelines. |
| FR-M2-12 | The system shall retain each resource baseline, recommended range, calculation assumption, guideline source, authority source, and provenance record used in the recommendation. |
| FR-M2-13 | The system shall present a consolidated assessment containing the AI-identified hazards, AI-proposed category scores, validated category risk values, calculated overall score and Low/Medium/High risk level, source evidence, validation warnings, confidence indicators, advisory explanations, assessment readiness, compliance status, and baseline safety-resource recommendations. |
| FR-M2-14 | The system shall provide organiser-safe assessment summaries and detailed authority assessment records according to role-based access restrictions, without exposing restricted evidence, internal validation details, AI prompts, or private assessment information to unauthorised users. |

## Cross-module ownership notes

- FR-M2-09: M2 retains authority confirmation or override provenance only when
  it is supplied by M3. M2 does not create or authorise the decision.
- FR-M2-10: M2 detects and records the MiniMax failure, preserves available
  assessment evidence, and creates a review-required handoff. The authorised
  manual-review process itself is performed by an Admin in **M3 — Authority
  Approval and Notification**.
