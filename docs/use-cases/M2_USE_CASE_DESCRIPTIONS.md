# Safety Resources Management and Smart Risk Assessment Module

## Use Case Descriptions

> Scope: Exact numeric formula values, weights, and thresholds are maintained in the active versioned configuration. MiniMax proposes category likelihood and severity scores; the system validates them and deterministically calculates the official risk result.

Use-case titles combine the formal identifier and an informative name, for example UC-M2-01-Assess-Submitted-Event-Application. Basic Flow follows the successful path. [FR-M2-xx] markers beside Actor/System actions show the functional requirement realised by that step. Alternative Flow uses one row per alternative, with its A1/A1.1/A1.2 steps kept in the same cell.

## Functional Requirement Traceability Matrix

| FR ID | Functional Requirement | Related Use Case(s) | Coverage Status / Dependency |
|---|---|---|---|
| FR-M2-01 | The system shall retrieve weather, public-holiday, venue, calendar, historical-event outcome, and verified assessment-eligible incident information relevant to the submitted event application. | UC-M2-01, UC-M2-03, UC-M2-04, UC-M2-05, UC-M2-07 | COVERED |
| FR-M2-02 | The system shall record the source, retrieval time, eligibility, synthetic-data indicator, and other provenance details for each contextual evidence item used in an assessment. | UC-M2-03, UC-M2-04, UC-M2-05, UC-M2-07, UC-M2-14 | COVERED |
| FR-M2-03 | The system shall validate whether the submitted event application contains sufficient evidence and required information before determining its assessment readiness, compliance status, and evidence-confidence level. | UC-M2-01, UC-M2-02, UC-M2-06, UC-M2-08 | COVERED |
| FR-M2-04 | The system shall send validated event data, contextual evidence, the active category rubric, configured hard rules, and relevant guidance to MiniMax M3 for structured hazard identification and category assessment. | UC-M2-01, UC-M2-12 | COVERED |
| FR-M2-05 | MiniMax M3 shall identify relevant hazards and propose a likelihood score, severity score, evidence references, rationale, confidence level, concerns, and missing-information indicators for each applicable assessment category. | UC-M2-01, UC-M2-12 | COVERED |
| FR-M2-06 | The system shall validate the MiniMax response against the required JSON schema, permitted categories, scoring ranges, available evidence references, configured hard rules, and the active assessment rubric. | UC-M2-01, UC-M2-10, UC-M2-12 | COVERED |
| FR-M2-07 | The system shall apply configured hard-rule constraints and deterministically calculate each category risk value and the overall risk result from the validated likelihood and severity scores using the active scoring formula, weights, thresholds, and guideline checks. | UC-M2-01, UC-M2-09 | COVERED |
| FR-M2-08 | The system shall record validation warnings for missing evidence, unsupported evidence references, invalid calculations, rubric conflicts, low-confidence outputs, and material differences between AI-proposed scores and hard-rule constraints, and shall mark affected assessments for authority review. | UC-M2-01, UC-M2-08, UC-M2-09, UC-M2-10, UC-M2-12 | COVERED |
| FR-M2-09 | The system shall retain the event input, contextual evidence, AI-identified hazards, AI-proposed category scores, evidence references, rationale, confidence indicators, validation results, hard-rule adjustments, calculated risk results, rubric version, prompt version, model identifier, and authority confirmation or override as an auditable assessment record. | UC-M2-01, UC-M2-02, UC-M2-06, UC-M2-09, UC-M2-10, UC-M2-12, UC-M2-14 | COVERED WITH DEPENDENCY — authority confirmation/override must be supplied by the Authority Approval Module. |
| FR-M2-10 | When MiniMax M3 is unavailable, times out, or returns invalid output, the system shall mark the AI-assisted assessment as unavailable or retryable and shall allow the assessment to proceed through an authorised manual-review process without fabricating category scores. | UC-M2-01, UC-M2-13 | COVERED |
| FR-M2-11 | The system shall generate baseline quantities and planning ranges for police, security, medical, ambulance, sanitation, waste-management, and fire-safety resources using the validated risk result, event characteristics, configured assumptions, and relevant guidelines. | UC-M2-01, UC-M2-11 | COVERED |
| FR-M2-12 | The system shall retain each resource baseline, recommended range, calculation assumption, guideline source, authority source, and provenance record used in the recommendation. | UC-M2-01, UC-M2-11, UC-M2-14 | COVERED |
| FR-M2-13 | The system shall present a consolidated assessment containing the AI-identified hazards, AI-proposed category scores, validated category risk values, calculated overall score and Low/Medium/High risk level, source evidence, validation warnings, confidence indicators, advisory explanations, assessment readiness, compliance status, and baseline safety-resource recommendations. | UC-M2-01, UC-M2-15, UC-M2-16, UC-M2-17, UC-M2-18 | COVERED |
| FR-M2-14 | The system shall provide organiser-safe assessment summaries and detailed authority assessment records according to role-based access restrictions, without exposing restricted evidence, internal validation details, AI prompts, or private assessment information to unauthorised users. | UC-M2-15, UC-M2-16, UC-M2-17, UC-M2-18 | COVERED |

## UC-M2-01-Assess-Submitted-Event-Application

| Field | Details |
|---|---|
| Use Case Name | UC-M2-01-Assess-Submitted-Event-Application |
| Description | Coordinates the complete Smart Risk Assessment and Safety Resource Recommendation Module workflow for one submitted event application. The use case retrieves and validates the submitted input and contextual evidence, requests structured hazard and category-score proposals from MiniMax M3, validates the AI response, deterministically calculates the official category and overall risk results, generates safety-resource planning ranges, consolidates the output, and stores the auditable records. Smart Risk Assessment and Safety Resource Recommendation Module does not approve or reject the event application. |
| Trigger | A new or explicitly recalculated submitted event application is ready for assessment. |
| Precondition | 1. The event application has been submitted and has a stable event identifier.<br>2. The application references one current submitted event-data record.<br>3. Smart Risk Assessment and Safety Resource Recommendation Module can access the required configuration and authorised integration credentials.<br>4. No completed assessment for the same immutable input and active configuration is already being processed as the current result. |
| Postcondition | 1. An assessment-processing record is stored with a final status of ready, incomplete, failed, or requiring review.<br>2. Available risk-assessment, AI-analysis, resource-recommendation, evidence-provenance, and audit information is linked to the submitted event application.<br>3. No approval or rejection decision is created by Smart Risk Assessment and Safety Resource Recommendation Module. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system detects that a submitted event application is ready for Smart Risk Assessment and Safety Resource Recommendation Module assessment. [FR-M2-03] |
|  | 2. The system creates or claims an assessment-processing job for the current submitted input. [A1] [FR-M2-09] |
|  | 3. The system records M1: “Assessment processing started.” |
|  | 4. The system continues by activating UC-M2-02 Retrieve Submitted Event Data. [A2] [FR-M2-03] [FR-M2-09] |
|  | 5. The system continues by activating UC-M2-08 Evaluate Readiness, Compliance and Evidence Confidence. [A3] [FR-M2-03] [FR-M2-08] |
|  | 6. The system continues by activating UC-M2-12 Generate AI-Assisted Analysis to obtain validated hazards and proposed category scores. [A4] [FR-M2-04] [FR-M2-05] [FR-M2-06] [FR-M2-08] |
|  | 7. The system continues by activating UC-M2-09 Perform Risk Assessment using the validated AI proposals and configured hard rules. [A5] [FR-M2-07] [FR-M2-08] |
|  | 8. The system continues by activating UC-M2-11 Generate Safety Resource Recommendation. [A6] [FR-M2-11] [FR-M2-12] |
|  | 9. The system consolidates hazards, AI-proposed scores, validated category risk values, overall risk, warnings, confidence, readiness/compliance, evidence, and resource recommendations. [FR-M2-13] |
|  | 10. The system continues by activating UC-M2-14 Store Assessment and Resource Records. [A7] [FR-M2-02] [FR-M2-09] [FR-M2-12] |
|  | 11. The system marks the processing job completed or review-required and publishes the current Smart Risk Assessment and Safety Resource Recommendation Module record identifiers to authorised consumers. [FR-M2-09] [FR-M2-13] |
|  | 12. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Duplicate or active processing claim<br>A1.1 At Step 2, the system finds an existing completed result for the same immutable input and active configuration, or an unexpired processing claim.<br>A1.2 The system does not create a duplicate assessment.<br>A1.3 The system returns the existing status and record identifiers.<br>A1.4 The use case ends. |
| A2: Submitted event data cannot be retrieved<br>A2.1 At Step 4, UC-M2-02 reports missing, inaccessible, or inconsistent submitted data.<br>A2.2 The system records the processing job as failed or insufficient-data according to the failure type.<br>A2.3 The system records M2: “Submitted event data could not be prepared for assessment.”<br>A2.4 The system attempts to store the failure and audit information through UC-M2-14.<br>A2.5 The use case ends. |
| A3: Evidence is not ready or compliance requires review<br>A3.1 At Step 5, UC-M2-08 returns incomplete, provisional, review-required, or blocked findings.<br>A3.2 The system preserves the findings and missing-evidence reasons.<br>A3.3 If C2 allows provisional assessment, the use case returns to Step 6 with the limitation attached to the result.<br>A3.4 Otherwise, the system skips Steps 6–8, continues at Step 9 with an incomplete assessment state, and requires human review. |
| A4: AI assessment is unavailable or invalid<br>A4.1 At Step 6, UC-M2-12 cannot return a validated AI assessment because MiniMax is unavailable, times out, or returns invalid output.<br>A4.2 The system triggers UC-M2-13 Handle AI Failure and records unavailable or retryable status.<br>A4.3 The system does not fabricate category scores.<br>A4.4 The application is routed to the authorised manual-review process and the use case continues at Step 9 with assessment status review-required. |
| A5: Deterministic risk calculation cannot be completed<br>A5.1 At Step 7, the validated AI proposal, hard-rule configuration, scoring formula, weights, thresholds, or guideline checks cannot produce a valid result.<br>A5.2 The system records the failed validation/calculation checks and marks the assessment for authority review.<br>A5.3 The system attempts UC-M2-14 to preserve the input, warnings, and failure provenance.<br>A5.4 The use case continues at Step 9 with risk result unavailable and review-required status. |
| A6: Resource recommendation cannot be generated<br>A6.1 At Step 8, the resource configuration or validated risk inputs do not support a defensible recommendation.<br>A6.2 The system records the affected resource items as unavailable or requiring review without inventing quantities.<br>A6.3 The use case returns to Step 9. |
| A7: Final storage conflict or failure<br>A7.1 At Step 10, the submitted event reference changed, the processing claim was lost, or the database transaction failed.<br>A7.2 The system cancels the final publication of the stale or partial result.<br>A7.3 The system retries only when C3 permits a safe idempotent retry.<br>A7.4 If the retry succeeds, return to Step 11; otherwise, the use case ends with storage-failed status. |

### Messages

| ID | Message |
|---|---|
| M1 | Assessment processing started. |
| M2 | Submitted event data could not be prepared for assessment. |
| M3 | Risk assessment requires recalculation or manual review. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | One immutable submitted input and one active configuration must not create duplicate current results. |
| C2 | The active assessment policy defines whether a provisional assessment may continue when evidence is incomplete. |
| C3 | Retries must be idempotent and must not overwrite a newer submitted event input. |

## UC-M2-02-Retrieve-Submitted-Event-Data

| Field | Details |
|---|---|
| Use Case Name | UC-M2-02-Retrieve-Submitted-Event-Data |
| Description | Obtains the submitted event information required by Smart Risk Assessment and Safety Resource Recommendation Module and converts it into a consistent assessment input. This use case retrieves only the submitted event record and its referenced immutable data; it does not permit Smart Risk Assessment and Safety Resource Recommendation Module to edit organiser-owned application information. |
| Trigger | UC-M2-01 requests the submitted event input for assessment. |
| Precondition | 1. A valid event identifier is available.<br>2. The requesting workflow is authorised to read the submitted application. |
| Postcondition | 1. A normalized, read-only assessment input is returned with event, schedule, venue, attendance, organiser-safe evidence references, and source identifiers.<br>2. Missing or inconsistent required data is reported to the calling use case. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system receives the event identifier and the expected submitted-data reference. [FR-M2-03] |
|  | 2. The system continues by activating UC-M2-06 Provide Submitted Event Data. [A1] [FR-M2-03] [FR-M2-09] |
|  | 3. The system verifies that the returned record belongs to the requested event and represents the current submitted input. [A2] [FR-M2-03] [FR-M2-09] |
|  | 4. The system extracts the event name/type, date and duration, venue/location/capacity, expected attendance, event characteristics, and evidence references. [FR-M2-01] [FR-M2-03] |
|  | 5. The system normalizes dates, identifiers, enumerated values, and optional fields without changing their meaning. [A3] [FR-M2-03] |
|  | 6. The system records the source record identifier, retrieval time, and submitted-input identifier. [FR-M2-02] [FR-M2-09] |
|  | 7. The system returns the normalized submitted event data to the calling use case. [FR-M2-03] |
|  | 8. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Database cannot return the record<br>A1.1 At Step 2, the database reports that the event or submitted-data record does not exist, is unavailable, or cannot be read.<br>A1.2 The system records M1: “Submitted event data is unavailable.”<br>A1.3 The use case returns failure to UC-M2-01 and ends. |
| A2: Submitted reference is stale or inconsistent<br>A2.1 At Step 3, the returned record does not match the expected event, submission state, or current input reference.<br>A2.2 The system rejects the record and records the mismatched identifiers.<br>A2.3 The use case returns stale-input status to UC-M2-01 and ends. |
| A3: Optional fields require normalization<br>A3.1 At Step 5, an optional field is blank, uses an accepted legacy value, or requires timezone normalization.<br>A3.2 The system applies the documented normalization and records the original value when provenance requires it.<br>A3.3 The use case returns to Step 6. |

### Messages

| ID | Message |
|---|---|
| M1 | Submitted event data is unavailable. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Smart Risk Assessment and Safety Resource Recommendation Module must treat submitted event data as read-only. |
| C2 | Required fields are defined by the active input schema, not by the future risk formula. |
| C3 | Dates and times must be normalized using the configured event timezone. |

## UC-M2-03-Retrieve-Contextual-Evidence

| Field | Details |
|---|---|
| Use Case Name | UC-M2-03-Retrieve-Contextual-Evidence |
| Description | Builds a contextual-evidence snapshot for the submitted event by combining weather, public-holiday, venue, calendar, historical-event outcome, and verified assessment-eligible incident information. Every item is accompanied by source, retrieval time, eligibility, synthetic-data status, and other provenance required to distinguish verified, stale, unavailable, synthetic, and ineligible evidence. |
| Trigger | A calling assessment use case requests contextual evidence for a normalized submitted event. |
| Precondition | 1. Normalized event date, venue/location, and event identifiers are available.<br>2. The active context-source configuration is available. |
| Postcondition | 1. A versioned contextual-evidence snapshot is returned.<br>2. Unavailable sources are represented explicitly and are not replaced with fabricated data. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system receives the normalized event date, venue/location, event characteristics, and evidence request. [FR-M2-01] |
|  | 2. The system checks whether a current context snapshot already satisfies the configured freshness rules. [A1] [FR-M2-02] |
|  | 3. The system continues by activating UC-M2-04 Provide Weather Data. [A2] [FR-M2-01] [FR-M2-02] |
|  | 4. The system continues by activating UC-M2-05 Provide Public Holiday Data. [A3] [FR-M2-01] [FR-M2-02] |
|  | 5. The system continues by activating UC-M2-07 Provide Venue History Data. [A4] [FR-M2-01] [FR-M2-02] |
|  | 6. The system requests historical-event outcomes and verified assessment-eligible incident information from Firestore Database. [FR-M2-01] [FR-M2-02] |
| 7. Firestore Database returns eligible historical-event and incident records with event date, venue linkage, eligibility status, and provenance. [A6] [FR-M2-01] [FR-M2-02] |  |
|  | 8. The system validates source identity, retrieval time, event-date relevance, eligibility, and synthetic-data indicators for every returned item. [A5] [FR-M2-02] |
|  | 9. The system combines available items into one contextual-evidence snapshot without merging contradictory values silently. [FR-M2-01] [FR-M2-02] |
|  | 10. The system calculates an evidence-availability and confidence summary without deciding the final risk-assessment method. [FR-M2-03] |
|  | 11. The system returns the contextual-evidence snapshot to the calling use case. [FR-M2-01] [FR-M2-02] [FR-M2-03] |
|  | 12. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Reusable context snapshot exists<br>A1.1 At Step 2, the system finds a snapshot for the same submitted input whose sources remain within their freshness windows.<br>A1.2 The system verifies the snapshot provenance and returns it to Step 10. |
| A2: Weather data is unavailable<br>A2.1 At Step 3, UC-M2-04 returns unavailable, outside-horizon, or stale weather status.<br>A2.2 The system stores the status and explanation instead of assuming normal weather.<br>A2.3 The use case returns to Step 4. |
| A3: Public-holiday data is unavailable<br>A3.1 At Step 4, UC-M2-05 cannot classify the date against the configured dataset.<br>A3.2 The system records calendar evidence as unavailable and continues at Step 5. |
| A4: Venue history is absent or unmatched<br>A4.1 At Step 5, UC-M2-07 reports no stable venue match or no eligible history.<br>A4.2 The system records an empty eligible-history result with the selection criteria used.<br>A4.3 The use case returns to Step 6. |
| A5: Sources contradict or fail provenance checks<br>A5.1 At Step 8, two sources conflict, an item lacks a timestamp/source identifier, or a record is not assessment-eligible.<br>A5.2 The system excludes or flags the affected item and records the reason.<br>A5.3 The use case returns to Step 9 with reduced evidence confidence. |
| A6: Verified incident information is unavailable or ineligible<br>A6.1 At Step 7, Firestore returns no eligible incident records, unavailable status, or records that fail assessment-eligibility checks.<br>A6.2 The system excludes ineligible incident records, records the reason and provenance, and does not represent absence as proof of no incident risk.<br>A6.3 The use case returns to Step 8. |

### Messages

| ID | Message |
|---|---|
| M1 | Some contextual evidence is unavailable; assessment readiness may be reduced. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | No unavailable source may be represented as normal, safe, or zero-risk evidence. |
| C2 | Historical records must be selected only by documented eligibility and comparison criteria. |
| C3 | Every context item must retain source, retrieval time, relevance, eligibility, and synthetic-data status where applicable. |

## UC-M2-04-Provide-Weather-Data

| Field | Details |
|---|---|
| Use Case Name | UC-M2-04-Provide-Weather-Data |
| Description | Retrieves weather information relevant to the event location and scheduled period from OpenWeather API and converts the response into Smart Risk Assessment and Safety Resource Recommendation Module weather evidence with source and freshness metadata. |
| Trigger | Smart Risk Assessment and Safety Resource Recommendation Module requests weather evidence for an event location and scheduled time. |
| Precondition | 1. The event has a usable location and scheduled start time.<br>2. OpenWeather credentials and endpoint configuration are available. |
| Postcondition | 1. Relevant weather evidence or an explicit unavailable/outside-horizon status is returned.<br>2. The raw provider status and retrieval timestamp are retained. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system validates the event location, scheduled time, and requested forecast period. [A1] [FR-M2-01] |
|  | 2. The system constructs a provider request containing only the location/time parameters required by OpenWeather. [FR-M2-01] |
|  | 3. The system sends the request to OpenWeather API. [A2] [FR-M2-01] |
| 4. OpenWeather API authenticates the request and searches its available current/forecast data. [FR-M2-01] |  |
| 5. OpenWeather API returns weather observations/forecast values, provider timestamp, and response status. [A3] [FR-M2-01] [FR-M2-02] |  |
|  | 6. The system validates the response structure, units, coordinates/location relevance, provider timestamp, and event-period applicability. [A4] [FR-M2-02] |
|  | 7. The system normalizes accepted values and labels the evidence freshness and forecast relationship to the event time. [FR-M2-02] |
|  | 8. The system returns the weather-evidence record to UC-M2-03. [FR-M2-01] [FR-M2-02] |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Location or date is unusable<br>A1.1 At Step 1, location coordinates/name or the event time is missing or invalid.<br>A1.2 The system returns weather status unavailable with reason invalid-input.<br>A1.3 The use case ends. |
| A2: Provider is unavailable, rate-limited, or times out<br>A2.1 At Step 3, the request fails, exceeds C2, or returns a provider error.<br>A2.2 The system performs only the configured bounded retry.<br>A2.3 If the retry fails, the system returns unavailable status and the provider error category.<br>A2.4 The use case ends. |
| A3: Event is outside the available forecast horizon<br>A3.1 At Step 5, the provider cannot supply event-period forecast data.<br>A3.2 The system returns outside-horizon/provisional status and does not substitute present-day conditions.<br>A3.3 The use case ends. |
| A4: Response is malformed or irrelevant<br>A4.1 At Step 6, required fields are absent, values are invalid, units are unsupported, or the response location/time does not match the request.<br>A4.2 The system rejects the response and returns invalid-response status.<br>A4.3 The use case ends. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Only event-relevant weather data may be treated as contextual evidence. |
| C2 | Provider timeout and retry limits must be configured and bounded. |
| C3 | Outside-horizon weather must be labelled provisional or unavailable, never assumed clear. |

## UC-M2-05-Provide-Public-Holiday-Data

| Field | Details |
|---|---|
| Use Case Name | UC-M2-05-Provide-Public-Holiday-Data |
| Description | Classifies the event date using the maintained public-holiday/calendar dataset and returns the holiday, adjacent-day, weekday, and weekend context required by Smart Risk Assessment and Safety Resource Recommendation Module. |
| Trigger | Smart Risk Assessment and Safety Resource Recommendation Module requests calendar context for the event date. |
| Precondition | 1. A normalized local event date is available.<br>2. A public-holiday dataset and version identifier are configured. |
| Postcondition | 1. Calendar context is returned with dataset version, source timestamp, and match information.<br>2. Dataset failure is represented explicitly. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system converts the event time to the configured local calendar date. [A1] [FR-M2-01] |
|  | 2. The system requests matching holiday records and adjacent-date context from the Public Holiday Dataset. [FR-M2-01] |
| 3. The Public Holiday Dataset returns matching entries, jurisdiction, observed date, and dataset version. [A2] [FR-M2-01] [FR-M2-02] |  |
|  | 4. The system verifies that returned records apply to the event jurisdiction and date. [A3] [FR-M2-01] [FR-M2-02] |
|  | 5. The system derives weekday/weekend, public-holiday, and configured adjacent-holiday indicators. [FR-M2-01] |
|  | 6. The system records the dataset version, source timestamp, match result, and retrieval time. [FR-M2-02] |
|  | 7. The system returns the calendar-context record to UC-M2-03. [FR-M2-01] [FR-M2-02] |
|  | 8. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Event date cannot be normalized<br>A1.1 At Step 1, the event time or timezone is missing or invalid.<br>A1.2 The system returns calendar status unavailable with reason invalid-date.<br>A1.3 The use case ends. |
| A2: Dataset cannot be read<br>A2.1 At Step 3, the dataset is unavailable, corrupt, or lacks a version/source timestamp.<br>A2.2 The system returns unavailable status without assuming the date is not a holiday.<br>A2.3 The use case ends. |
| A3: Multiple or conflicting entries exist<br>A3.1 At Step 4, multiple entries disagree about the applicable date or jurisdiction.<br>A3.2 The system retains the conflict, sets review-required status, and does not silently choose one entry.<br>A3.3 The use case returns to Step 6. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Calendar classification must use the event-local date. |
| C2 | A no-match result is valid only when the dataset itself is available and applicable. |
| C3 | Dataset version and source timestamp are mandatory provenance fields. |

## UC-M2-06-Provide-Submitted-Event-Data

| Field | Details |
|---|---|
| Use Case Name | UC-M2-06-Provide-Submitted-Event-Data |
| Description | Returns the requested submitted event record and immutable event-data payload from Firestore to Smart Risk Assessment and Safety Resource Recommendation Module. This supporting use case represents the database interaction used by UC-M2-02. |
| Trigger | Smart Risk Assessment and Safety Resource Recommendation Module requests a submitted event by event identifier and expected submitted-data reference. |
| Precondition | 1. The database connection is available.<br>2. The requesting service has server-authorised access. |
| Postcondition | 1. The requested event and submitted event-data record are returned, or a precise not-found/access/error status is returned. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system sends the event identifier and expected submitted-data reference to Firestore Database. [FR-M2-03] [FR-M2-09] |
| 2. Firestore Database locates the event record. [A1] [FR-M2-03] [FR-M2-09] |  |
| 3. Firestore Database locates the referenced submitted event-data record. [A2] [FR-M2-03] [FR-M2-09] |  |
| 4. Firestore Database returns both records with their stored identifiers and update/version metadata. [A3] [FR-M2-09] |  |
|  | 5. The system acknowledges receipt and returns the records to UC-M2-02. [FR-M2-03] [FR-M2-09] |
|  | 6. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Event record does not exist<br>A1.1 At Step 2, Firestore Database returns event-not-found.<br>A1.2 The system returns the not-found status to UC-M2-02.<br>A1.3 The use case ends. |
| A2: Submitted-data record does not exist<br>A2.1 At Step 3, the event exists but the referenced submitted-data record is missing.<br>A2.2 The system returns inconsistent-reference status to UC-M2-02.<br>A2.3 The use case ends. |
| A3: Database read fails<br>A3.1 At Step 4, Firestore Database returns permission, availability, transaction, or transport failure.<br>A3.2 The system records only the safe error category and returns database-read-failed status.<br>A3.3 The use case ends. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Database records must be read by exact stable identifiers; name matching must not identify the submitted input. |
| C2 | Sensitive organiser data not required by Smart Risk Assessment and Safety Resource Recommendation Module must not be copied into downstream AI or public outputs. |

## UC-M2-07-Provide-Venue-History-Data

| Field | Details |
|---|---|
| Use Case Name | UC-M2-07-Provide-Venue-History-Data |
| Description | Retrieves assessment-eligible venue and historical-event evidence from Firestore using stable venue identity and documented comparison criteria. It returns an empty result when no eligible history exists rather than treating absence as positive or negative risk evidence. |
| Trigger | Smart Risk Assessment and Safety Resource Recommendation Module requests venue/history context for the submitted event. |
| Precondition | 1. The submitted event contains a venue identifier or sufficient venue attributes for an explicit match attempt.<br>2. Historical-data eligibility fields are available. |
| Postcondition | 1. Matched venue context and eligible comparable history are returned with selection criteria and provenance.<br>2. Ineligible, future, unverified, or otherwise excluded records are not used as assessment evidence. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system sends the stable venue identifier and relevant comparison attributes to Firestore Database. [FR-M2-01] |
| 2. Firestore Database retrieves the venue record. [A1] [FR-M2-01] |  |
| 3. Firestore Database retrieves candidate completed-event and incident-history records before the submitted event date. [A2] [FR-M2-01] |  |
|  | 4. The system filters candidates by assessment eligibility, status, event date, stable venue match, and configured comparison criteria. [FR-M2-01] [FR-M2-02] |
|  | 5. The system excludes rejected, pending, future, unverified, and assessment-ineligible records and records exclusion counts. [FR-M2-01] [FR-M2-02] |
|  | 6. The system normalizes available historical outcome measures only when their denominators and definitions are present. [A3] [FR-M2-02] |
|  | 7. The system returns matched venue context, eligible history, selection criteria, retrieval time, and synthetic-data indicators to UC-M2-03. [FR-M2-01] [FR-M2-02] |
|  | 8. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Venue cannot be matched<br>A1.1 At Step 2, no stable venue match exists or multiple ambiguous matches are returned.<br>A1.2 The system returns unmatched-venue status and does not combine records by venue name alone.<br>A1.3 The use case ends. |
| A2: No eligible historical records exist<br>A2.1 At Step 3, Firestore Database returns no candidates or all candidates are excluded at Steps 4–5.<br>A2.2 The system creates an empty eligible-history result with the selection/exclusion summary.<br>A2.3 The use case returns to Step 7. |
| A3: Historical outcome cannot be normalized<br>A3.1 At Step 6, a record lacks required denominators, definitions, timestamps, or provenance.<br>A3.2 The system excludes the affected measure and records the reason.<br>A3.3 The use case returns to Step 7. |
| A4: Database query fails<br>A4.1 At Steps 2 or 3, the database query fails.<br>A4.2 The system returns history-unavailable status and the safe error category.<br>A4.3 The use case ends. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Venue history must be linked by a stable venue identifier or an explicit reviewed match. |
| C2 | Only records occurring before the assessed event and marked assessment-eligible may be used. |
| C3 | Synthetic/demo records must remain explicitly labelled and must not be represented as real history. |

## UC-M2-08-Evaluate-Readiness-Compliance-and-Evidence-Confidence

| Field | Details |
|---|---|
| Use Case Name | UC-M2-08-Evaluate-Readiness-Compliance-and-Evidence-Confidence |
| Description | Evaluates whether the submitted event contains sufficient required information, whether configured compliance checks pass or require review, and how strongly available evidence supports assessment. Readiness, compliance, and evidence confidence remain separate outputs. |
| Trigger | UC-M2-01 supplies normalized submitted event data and available evidence references. |
| Precondition | 1. Submitted event data has been retrieved.<br>2. The active input/evidence requirements and compliance-check configuration are available. |
| Postcondition | 1. Readiness, compliance, and evidence-confidence results are returned with reasons and missing/failed checks.<br>2. No risk level or authority approval decision is inferred from these gate results. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system loads the active required-information, evidence, and compliance-check configuration. [A1] [FR-M2-03] |
|  | 2. The system checks every required submitted field and required supporting-evidence reference. [A2] [FR-M2-03] |
|  | 3. The system checks configured venue-capacity, fire/life-safety, schedule, and other compliance conditions without substituting a risk score for compliance. [A3] [FR-M2-03] |
|  | 4. The system verifies the source, freshness, eligibility, completeness, and consistency of available evidence. [A4] [FR-M2-02] [FR-M2-03] |
|  | 5. The system classifies assessment readiness using the active readiness definitions. [FR-M2-03] |
|  | 6. The system classifies compliance status using the active compliance definitions. [FR-M2-03] |
|  | 7. The system classifies evidence confidence using the active confidence definitions. [FR-M2-03] |
|  | 8. The system creates a reason list linking each result to the relevant field, evidence item, or failed check. [FR-M2-03] [FR-M2-08] |
|  | 9. The system returns the three separate results and reason list to UC-M2-01. [FR-M2-03] [FR-M2-08] |
|  | 10. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Evaluation configuration is unavailable<br>A1.1 At Step 1, the system cannot load a valid active configuration.<br>A1.2 The system returns evaluation-failed status and M1: “Readiness and compliance checks are unavailable.”<br>A1.3 The use case ends. |
| A2: Required information or evidence is missing<br>A2.1 At Step 2, one or more required fields/evidence references are absent or unusable.<br>A2.2 The system records each missing item and classifies readiness as incomplete/provisional according to the configuration.<br>A2.3 The use case returns to Step 3. |
| A3: Compliance condition fails or cannot be confirmed<br>A3.1 At Step 3, a configured compliance condition is violated or lacks enough evidence.<br>A3.2 The system marks the condition blocked or review-required and records the reason.<br>A3.3 The use case returns to Step 4. |
| A4: Evidence is stale, contradictory, synthetic, or ineligible<br>A4.1 At Step 4, an evidence item fails one or more quality/provenance checks.<br>A4.2 The system excludes or downgrades the item according to the active evidence policy.<br>A4.3 The system records the reason and returns to Step 5. |

### Messages

| ID | Message |
|---|---|
| M1 | Readiness and compliance checks are unavailable. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Readiness, compliance, evidence confidence, and risk are independent outputs. |
| C2 | Every failed or unconfirmed check must identify the affected requirement/evidence. |
| C3 | The gate definitions may be versioned without fixing the future assessment formula in this use case. |

## UC-M2-09-Perform-Risk-Assessment

| Field | Details |
|---|---|
| Use Case Name | UC-M2-09-Perform-Risk-Assessment |
| Description | Deterministically calculates category risk values and the overall Low, Medium, or High risk result from the validated MiniMax-proposed likelihood and severity scores. The system applies the active scoring formula, category weights, thresholds, guideline checks, and configured hard-rule constraints; AI does not directly determine the official calculated result. |
| Trigger | UC-M2-01 requests calculation after UC-M2-12 returns a validated AI assessment. |
| Precondition | 1. Validated applicable categories, hazards, likelihood scores, severity scores, evidence references, rationale, and confidence indicators are available.<br>2. The active scoring formula, category weights, thresholds, guideline checks, hard rules, and version identifiers are available.<br>3. Readiness, compliance, and evidence-confidence findings are available. |
| Postcondition | 1. Validated category risk values and a calculated overall numeric score and Low/Medium/High risk level are produced, or an explicit unable-to-calculate status is returned.<br>2. Hard-rule adjustments, calculation inputs, versions, warnings, and review-required indicators remain traceable. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system loads the active scoring formula, weights, thresholds, guideline checks, hard rules, and version identifiers. [A1] [FR-M2-07] |
|  | 2. The system receives the validated MiniMax category proposals and validation metadata from UC-M2-12/UC-M2-10. [A2] [FR-M2-07] [FR-M2-08] |
|  | 3. The system verifies that each applicable category has accepted likelihood, severity, evidence, confidence, and validation status. [FR-M2-07] |
|  | 4. The system applies configured hard-rule minimums, maximums, overrides, or review conditions and records every adjustment. [A3] [FR-M2-07] [FR-M2-08] |
|  | 5. The system deterministically calculates each category risk value from the validated likelihood and severity scores using the active formula. [FR-M2-07] |
|  | 6. The system applies configured category weights and guideline checks and deterministically calculates the overall numeric score and Low/Medium/High risk level. [A4] [FR-M2-07] |
|  | 7. The system records differences between AI-proposed scores and hard-rule-adjusted values, calculation warnings, and authority-review indicators. [FR-M2-08] [FR-M2-09] |
|  | 8. The system returns the calculated result and full provenance to UC-M2-01. [FR-M2-07] [FR-M2-09] |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Scoring configuration is missing or invalid<br>A1.1 At Step 1, a required formula, weight, threshold, hard rule, guideline check, or version identifier is missing or inconsistent.<br>A1.2 The system records configuration-error status and identifies the missing or invalid configuration.<br>A1.3 The use case returns unable-to-calculate and ends. |
| A2: Validated AI category input is incomplete<br>A2.1 At Step 2, one or more applicable categories lacks an accepted likelihood score, severity score, or required evidence reference.<br>A2.2 The system records a missing-input warning and marks the affected assessment for authority review.<br>A2.3 The use case returns unable-to-calculate and ends; the system does not fabricate a score. |
| A3: Hard rule conflicts with the AI proposal<br>A3.1 At Step 4, an AI-proposed score violates a configured hard-rule constraint or materially differs from the permitted value.<br>A3.2 The system applies the documented hard-rule constraint, retains both the proposed and adjusted values, and records the reason.<br>A3.3 The system marks the category for authority review and returns to Step 5. |
| A4: Calculation or result-range validation fails<br>A4.1 At Step 6, a category or overall result is non-finite, outside its permitted range, inconsistent, or cannot be mapped to a configured risk level.<br>A4.2 The system records each calculation failure and rejects the affected result without silently clamping it.<br>A4.3 The use case returns unable-to-calculate and ends. |

### Messages

| ID | Message |
|---|---|
| M1 | Risk calculation requires authorised review. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | The formula, weights, thresholds, hard rules, guideline checks, and rubric versions must be versioned. |
| C2 | The same validated scores and active calculation configuration must produce the same official calculated result. |
| C3 | Both AI-proposed and hard-rule-adjusted values must be retained; adjustments must never be silent. |
| C4 | Smart Risk Assessment and Safety Resource Recommendation Module must not make the authority approval or rejection decision. |

## UC-M2-10-Validate-Assessment-Result

| Field | Details |
|---|---|
| Use Case Name | UC-M2-10-Validate-Assessment-Result |
| Description | Validates the structured MiniMax M3 response before any proposed category score can be used in the deterministic risk calculation. Validation covers the required JSON schema, permitted categories, likelihood/severity ranges, available evidence references, the active rubric, configured hard rules, confidence, missing-information indicators, and internal consistency. |
| Trigger | UC-M2-12 receives and parses a structured MiniMax M3 response. |
| Precondition | 1. A parsed MiniMax response and its request/input identifiers are available.<br>2. The active JSON schema, category rubric, permitted scoring ranges, hard rules, and evidence snapshot are available. |
| Postcondition | 1. Each hazard/category proposal is accepted, rejected, or flagged with explicit validation results and warnings.<br>2. Only accepted likelihood and severity scores are made available to UC-M2-09.<br>3. Material conflicts, unsupported evidence, invalid calculations, and low-confidence outputs are marked for authority review. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system receives the parsed MiniMax response, submitted-input identifier, evidence snapshot identifier, rubric version, prompt version, and model identifier. [FR-M2-06] [FR-M2-09] |
|  | 2. The system validates the response against the required JSON schema. [A1] [FR-M2-06] |
|  | 3. The system verifies that every returned category is permitted by the active category rubric. [A2] [FR-M2-06] |
|  | 4. The system validates likelihood and severity values against configured types and scoring ranges. [A3] [FR-M2-06] |
|  | 5. The system verifies that every cited evidence reference exists, is eligible, and belongs to the accepted evidence snapshot. [A4] [FR-M2-06] |
|  | 6. The system checks each proposal against configured hard rules and the active rubric and records conflicts or required adjustments. [A5] [FR-M2-06] [FR-M2-08] |
|  | 7. The system checks required hazards, rationale, confidence, concerns, and missing-information indicators for completeness and internal consistency. [A6] [FR-M2-05] [FR-M2-06] |
|  | 8. The system creates validation warnings for unsupported evidence, invalid values/calculations, rubric conflicts, low confidence, and material hard-rule differences. [FR-M2-08] |
|  | 9. The system marks materially affected categories or the assessment for authority review. [FR-M2-08] [FR-M2-09] |
|  | 10. The system returns accepted proposals, rejected items, warnings, and validation provenance to UC-M2-12. [FR-M2-06] [FR-M2-09] |
|  | 11. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: JSON schema validation fails<br>A1.1 At Step 2, required fields are missing, types are invalid, JSON is malformed, or unsupported fields prevent safe interpretation.<br>A1.2 The system rejects the response, records every schema error, and returns invalid-output status to UC-M2-12.<br>A1.3 UC-M2-12 triggers UC-M2-13 Handle AI Failure and this use case ends. |
| A2: Unsupported category is returned<br>A2.1 At Step 3, MiniMax returns a category not permitted by the active rubric.<br>A2.2 The system rejects the unsupported category and records a rubric-conflict warning.<br>A2.3 If required categories remain complete, the use case returns to Step 4; otherwise it returns invalid-output status and ends. |
| A3: Proposed score is outside the permitted range<br>A3.1 At Step 4, likelihood or severity is missing, non-numeric, non-finite, or outside the configured range.<br>A3.2 The system rejects the affected proposal without inventing, clamping, or silently correcting the score.<br>A3.3 The system records an invalid-score warning and returns to Step 5 for the remaining proposals. |
| A4: Evidence reference is unsupported<br>A4.1 At Step 5, a referenced item does not exist, is ineligible, is restricted for this purpose, or belongs to another evidence snapshot.<br>A4.2 The system records an unsupported-evidence warning and rejects or flags the affected proposal according to the rubric.<br>A4.3 The system returns to Step 6. |
| A5: AI proposal conflicts with a hard rule or rubric<br>A5.1 At Step 6, the proposal violates a hard-rule constraint or materially differs from the rule-required score.<br>A5.2 The system retains the AI-proposed value, records the required hard-rule adjustment and rationale, and marks the category for authority review.<br>A5.3 The system returns to Step 7. |
| A6: Confidence is low or rationale is incomplete<br>A6.1 At Step 7, confidence is below the configured threshold or rationale/concerns/missing-information indicators are incomplete.<br>A6.2 The system records a low-confidence or incomplete-explanation warning and marks the affected category for authority review.<br>A6.3 The system returns to Step 8. |

### Messages

| ID | Message |
|---|---|
| M1 | MiniMax response is invalid or requires authority review. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Only categories in the active rubric may be accepted. |
| C2 | Invalid or missing scores must never be fabricated, clamped, or silently corrected. |
| C3 | Every accepted evidence reference must resolve to an eligible item in the assessment evidence snapshot. |
| C4 | All warnings, rejected proposals, and hard-rule conflicts must remain auditable. |

## UC-M2-11-Generate-Safety-Resource-Recommendation

| Field | Details |
|---|---|
| Use Case Name | UC-M2-11-Generate-Safety-Resource-Recommendation |
| Description | Generates baseline safety-resource recommendations for the submitted event using the validated event and assessment information, contextual evidence, and the active versioned resource-planning configuration. The result is a planning recommendation and not proof of deployment or authority approval. |
| Trigger | UC-M2-01 requests a resource recommendation after assessment inputs are available. |
| Precondition | 1. Submitted event data and available assessment findings are available.<br>2. The active resource-planning configuration and guideline references are available. |
| Postcondition | 1. A resource recommendation or explicit unavailable/review-required result is produced.<br>2. Every recommended item retains its assumptions, source/configuration version, rationale, and confidence/review status. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system loads the active resource-planning configuration, resource types, assumptions, and version identifiers. [A1] [FR-M2-11] |
|  | 2. The system continues by activating UC-M2-03 Retrieve Contextual Evidence. [A2] [FR-M2-01] [FR-M2-11] |
|  | 3. The system selects applicable event characteristics, validated assessment findings, and eligible contextual evidence. [FR-M2-11] |
|  | 4. The system applies the configured resource-planning method to each supported resource type. [A3] [FR-M2-11] |
|  | 5. The system creates a baseline quantity or range, rationale, assumptions, applicable modifiers, guideline references, and reviewing-authority information for each item. [FR-M2-11] [FR-M2-12] |
|  | 6. The system checks that quantities/ranges are finite, non-negative, internally consistent, and supported by the active configuration. [A4] [FR-M2-11] |
|  | 7. The system labels the recommendation’s confidence and authority-review requirement. [FR-M2-11] [FR-M2-12] |
|  | 8. The system returns the recommendation to UC-M2-01. [FR-M2-11] [FR-M2-12] |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Resource configuration is unavailable<br>A1.1 At Step 1, required resource types, assumptions, or version metadata cannot be loaded.<br>A1.2 The system returns resource-configuration-error status and does not invent quantities.<br>A1.3 The use case ends. |
| A2: Context is incomplete<br>A2.1 At Step 2, relevant context is unavailable or provisional.<br>A2.2 The system records the limitation and applies only the documented fallback permitted by the active configuration.<br>A2.3 The use case returns to Step 3 or ends as review-required when no defensible fallback exists. |
| A3: No configured rule applies to a resource item<br>A3.1 At Step 4, one resource type has no applicable method for the submitted event.<br>A3.2 The system marks that item unavailable/review-required and continues calculating other supported items.<br>A3.3 The use case returns to Step 5. |
| A4: Generated quantity/range is invalid<br>A4.1 At Step 6, an item is negative, non-finite, has a reversed range, or lacks required rationale/version data.<br>A4.2 The system rejects that item or the complete recommendation according to configuration.<br>A4.3 The use case returns unavailable/review-required status and ends. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Resource recommendations are indicative planning outputs, not confirmation that resources are deployed. |
| C2 | The planning method and assumptions must be versioned and reviewable. |
| C3 | No missing configuration may be replaced by an undocumented hard-coded quantity. |

## UC-M2-12-Generate-AI-Assisted-Analysis

| Field | Details |
|---|---|
| Use Case Name | UC-M2-12-Generate-AI-Assisted-Analysis |
| Description | Sends validated event data, contextual evidence, the active category rubric, configured hard rules, and relevant guidance to MiniMax M3. MiniMax identifies applicable hazards and proposes likelihood and severity scores, evidence references, rationale, confidence, concerns, and missing-information indicators; the system then activates UC-M2-10 before any proposal may be used for deterministic calculation. |
| Trigger | UC-M2-01 requests AI-assisted analysis for the current submitted input. |
| Precondition | 1. Allowlisted event data and relevant contextual evidence are available.<br>2. AI integration configuration and a response schema are available. |
| Postcondition | 1. A structured MiniMax response has been validated through UC-M2-10, or AI status is unavailable/invalid/retryable.<br>2. Accepted hazards and proposed scores, rejected items, warnings, model/prompt/rubric versions, and request/response provenance are retained. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system loads the active AI request/response schema, category rubric, hard rules, guidance, model identifier, prompt version, and safety restrictions. [A1] [FR-M2-04] [FR-M2-06] |
|  | 2. The system continues by activating UC-M2-03 Retrieve Contextual Evidence. [FR-M2-04] |
|  | 3. The system constructs an allowlisted payload containing validated event data, eligible contextual evidence, rubric definitions, hard rules, and relevant guidance. [FR-M2-04] |
|  | 4. The system sends the structured request to MiniMax M3 API. [A2] [FR-M2-04] |
| 5. MiniMax M3 API identifies relevant hazards and applicable assessment categories. [FR-M2-05] |  |
| 6. MiniMax M3 API proposes likelihood and severity scores, evidence references, rationale, confidence, concerns, and missing-information indicators for each applicable category. [FR-M2-05] |  |
| 7. MiniMax M3 API returns the structured JSON response and provider/model status. [A3] [FR-M2-05] |  |
|  | 8. The system parses the response and continues by activating UC-M2-10 Validate Assessment Result. [A4] [FR-M2-06] |
|  | 9. The system records accepted AI proposals, rejected items, validation warnings, review indicators, model/prompt/rubric/schema versions, timing, and request provenance. [FR-M2-08] [FR-M2-09] |
|  | 10. The system returns the validated AI assessment package to UC-M2-01 for deterministic calculation. [FR-M2-04] [FR-M2-05] [FR-M2-06] [FR-M2-09] |
|  | 11. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: AI contract/configuration is unavailable<br>A1.1 At Step 1, model, prompt, schema, or credential configuration is missing or invalid.<br>A1.2 IF configuration is unavailable, the system triggers UC-M2-13 Handle AI Failure.<br>A1.3 The use case returns the failure-handling result to UC-M2-01 and ends. |
| A2: API is unavailable or times out<br>A2.1 At Step 4, IF the API rejects the request, is rate-limited/unavailable, or exceeds the configured timeout, the system triggers UC-M2-13.<br>A2.2 The use case returns the failure-handling result to UC-M2-01 and ends. |
| A3: Provider returns no response or an error response<br>A3.1 At Step 7, IF MiniMax returns an empty response or provider/model error, the system triggers UC-M2-13.<br>A3.2 The use case returns the failure-handling result to UC-M2-01 and ends. |
| A4: MiniMax response fails validation<br>A4.1 At Step 8, UC-M2-10 rejects the complete response or returns insufficient accepted category proposals.<br>A4.2 IF the response cannot support deterministic calculation, the system triggers UC-M2-13 with invalid-output status.<br>A4.3 The unvalidated or rejected score is not used as an official calculated result.<br>A4.4 The use case returns the failure-handling result and ends. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Only allowlisted, non-sensitive data required for analysis may be sent to MiniMax. |
| C2 | The response must satisfy a versioned structured-response schema before presentation or storage as accepted analysis. |
| C3 | AI output must not approve/reject the event or silently change protected assessment/resource outputs. |
| C4 | Timeout and retry behavior must be bounded. |

## UC-M2-13-Handle-AI-Failure

| Field | Details |
|---|---|
| Use Case Name | UC-M2-13-Handle-AI-Failure |
| Description | Handles MiniMax configuration failure, timeout, provider error, empty response, and invalid structured output without fabricating hazards or category scores. It records unavailable or retryable status and routes the application to an authorised manual-review process when no validated AI assessment can be produced. |
| Trigger | IF UC-M2-12 encounters unavailable configuration/API, timeout, provider error, or invalid response. |
| Precondition | 1. UC-M2-12 has produced a classified AI failure and safe error details. |
| Postcondition | 1. AI status and safe failure provenance are stored or returned.<br>2. No fabricated hazard, likelihood score, severity score, or category result is produced.<br>3. The application is retryable or marked for authorised manual review according to policy. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system receives the classified AI failure, request identifier, attempt count, and safe provider details. [FR-M2-10] |
|  | 2. The system determines whether the failure is retryable under the active retry policy. [A1] [FR-M2-10] |
|  | 3. The system records AI status unavailable, invalid, or retryable and records M1: “AI-assisted analysis is currently unavailable.” [FR-M2-10] |
|  | 4. The system records failure time, model/prompt/schema versions, attempt count, and safe failure category. [FR-M2-09] [FR-M2-10] |
|  | 5. The system marks the assessment AI-unavailable/retryable and routes it to the authorised manual-review process. [A2] [FR-M2-10] |
|  | 6. The system returns the resulting status to UC-M2-12. [FR-M2-10] |
|  | 7. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Bounded retry is permitted<br>A1.1 At Step 2, the failure is transient and the attempt count is below C2.<br>A1.2 The system waits only for the configured backoff and retries the MiniMax request.<br>A1.3 If the retry succeeds, UC-M2-12 returns to its Step 7.<br>A1.4 If the retry fails, return to Step 3 of this use case. |
| A2: Authorised manual review is required<br>A2.1 At Step 5, no validated AI assessment is available for deterministic calculation.<br>A2.2 The system preserves the submitted input, contextual evidence, failure details, and any valid readiness/compliance findings.<br>A2.3 The system marks the assessment review-required and exposes the permitted manual-review action to an authorised authority role.<br>A2.4 The use case ends without fabricating category scores. |
| A3: Failure record cannot be stored immediately<br>A3.1 At Step 4, the database write fails.<br>A3.2 The system preserves the safe failure state in the parent transaction/logging path for later idempotent persistence.<br>A3.3 The use case returns to Step 5. |

### Messages

| ID | Message |
|---|---|
| M1 | AI-assisted analysis is currently unavailable. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | No placeholder, default, or invented AI analysis may be presented as a valid response. |
| C2 | Maximum attempts, timeout, and backoff are configured and bounded. |
| C3 | Stored errors must not expose credentials, raw secrets, or unnecessary sensitive input. |

## UC-M2-14-Store-Assessment-and-Resource-Records

| Field | Details |
|---|---|
| Use Case Name | UC-M2-14-Store-Assessment-and-Resource-Records |
| Description | Persists the Smart Risk Assessment and Safety Resource Recommendation Module processing status, submitted event input, contextual-evidence snapshot, AI-identified hazards and proposed scores, validation results and warnings, hard-rule adjustments, calculated risk results, resource recommendation, versions, provenance, and audit information. When supplied by the Authority Approval Module, the same auditable record also retains authority confirmation or override without allowing Smart Risk Assessment and Safety Resource Recommendation Module to create the authority decision. |
| Trigger | UC-M2-01 has consolidated a completed, incomplete, review-required, or failed Smart Risk Assessment and Safety Resource Recommendation Module result. |
| Precondition | 1. The submitted event and target assessment identifiers are available.<br>2. The caller owns a valid processing claim or equivalent concurrency guard. |
| Postcondition | 1. Consistent version-linked assessment, resource, evidence, validation, calculation, and audit records are stored, or no partial current result is published.<br>2. Any later authority confirmation or override received from the Authority Approval Module is linked to the assessment record with actor, reason, and timestamp provenance. |

### Basic Flow

| Actor | System |
|---|---|
|  | 1. The system prepares assessment, resource, context, AI-status, and audit records with stable event/input identifiers and version metadata. [FR-M2-02] [FR-M2-09] [FR-M2-12] |
|  | 2. The system starts a consistency-preserving Firestore transaction/batch. [A1] [FR-M2-09] |
| 3. Firestore Database returns the current event reference and processing-claim state. [FR-M2-09] |  |
|  | 4. The system verifies that the submitted input is still current and the caller still owns the processing claim. [A2] [FR-M2-09] |
|  | 5. The system writes the assessment-processing/final assessment record. [FR-M2-09] |
|  | 6. The system writes the resource-recommendation record when available. [FR-M2-12] |
|  | 7. The system writes context/provenance and assessment/resource audit entries. [FR-M2-02] [FR-M2-09] [FR-M2-12] |
|  | 8. The system updates only the event pointers/status fields owned by the Smart Risk Assessment and Safety Resource Recommendation Module contract. [FR-M2-09] |
| 9. Firestore Database commits the complete transaction/batch. [A3] [FR-M2-09] |  |
|  | 10. The system returns stored record identifiers and commit status to UC-M2-01. [FR-M2-09] |
|  | 11. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Transaction cannot start<br>A1.1 At Step 2, Firestore is unavailable or rejects the operation.<br>A1.2 The system performs only the configured idempotent retry.<br>A1.3 If the retry fails, the use case returns storage-failed status and ends. |
| A2: Submitted input changed or processing claim was lost<br>A2.1 At Step 4, a newer submitted input is current or another process owns/completed the job.<br>A2.2 The system aborts the transaction and does not publish the stale result.<br>A2.3 The use case returns stale-result/not-owner status and ends. |
| A3: Commit fails or conflicts<br>A3.1 At Step 9, Firestore reports a retryable conflict.<br>A3.2 The system reloads the concurrency guard and retries from Step 2 within C2.<br>A3.3 For non-retryable failure or exhausted attempts, the system returns storage-failed status and ends. |
| A4: Optional resource or AI record is unavailable<br>A4.1 Before Steps 6–7, the consolidated result contains an explicit unavailable resource or AI status.<br>A4.2 The system stores the status and provenance rather than omitting the condition silently.<br>A4.3 The use case returns to the next applicable write step. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | A stale result must never replace the current submitted input’s result. |
| C2 | Transaction retries must be bounded and idempotent. |
| C3 | Assessment, resource, input, method, AI, and guideline versions must remain traceable. |
| C4 | Smart Risk Assessment and Safety Resource Recommendation Module storage must not create authority decisions or claim real-world resource deployment. |

## UC-M2-15-View-Risk-Assessment

| Field | Details |
|---|---|
| Use Case Name | UC-M2-15-View-Risk-Assessment |
| Description | Allows an authorised Authority Officer to view the current Smart Risk Assessment and Safety Resource Recommendation Module risk-assessment record, readiness, compliance, evidence confidence, result explanation/provenance, and processing state for events within the officer’s permitted scope. |
| Trigger | The Authority Officer opens the Smart Risk Assessment and Safety Resource Recommendation Module risk-assessment page or selects an event assessment. |
| Precondition | 1. The Authority Officer is authenticated with an active authority profile.<br>2. The requested event is within the officer’s assigned scope. |
| Postcondition | 1. The authorised assessment information is displayed, or a safe empty/error/access-denied state is shown.<br>2. Viewing does not modify the assessment or create an authority decision. |

### Basic Flow

| Actor | System |
|---|---|
| 1. The Authority Officer opens View Risk Assessment. [FR-M2-13] [FR-M2-14] |  |
|  | 2. The system verifies the officer’s authentication, role, authority scope, and account status. [A1] [FR-M2-14] |
|  | 3. The system loads the event summary and current assessment-processing/assessment record. [A2] [FR-M2-13] [FR-M2-14] |
|  | 4. The system verifies that the record belongs to the current submitted input and supported assessment schema. [A3] [FR-M2-09] [FR-M2-14] |
|  | 5. The system displays readiness, compliance, evidence confidence, assessment result, component details, evidence/provenance, versions, and processing time/status. [FR-M2-13] [FR-M2-14] |
| 6. The Authority Officer reviews the displayed assessment and may expand supporting evidence/details. [FR-M2-13] [FR-M2-14] |  |
|  | 7. The system displays only evidence the officer is authorised to access. [A4] [FR-M2-14] |
| 8. The Authority Officer leaves the page or selects another assessment. |  |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Officer is unauthenticated or unauthorised<br>A1.1 At Step 2, the session is absent/expired or the account lacks the required role/scope.<br>A1.2 The system displays M1: “You are not authorised to view this assessment.”<br>A1.3 The use case ends. |
| A2: Assessment is processing, failed, or absent<br>A2.1 At Step 3, no ready current assessment exists.<br>A2.2 The system displays the current safe state: processing, failed/retryable, incomplete, or not yet available.<br>A2.3 The Authority Officer may refresh/retry loading; otherwise the use case ends. |
| A3: Legacy or stale assessment is detected<br>A3.1 At Step 4, the record belongs to an older input/schema or cannot be safely interpreted.<br>A3.2 The system labels the record legacy/stale and does not present it as the current result.<br>A3.3 The system offers the authorised recalculation route when available, then the use case ends. |
| A4: Restricted evidence is requested<br>A4.1 At Step 7, the officer selects evidence outside the permitted scope.<br>A4.2 The system denies the evidence request and keeps the assessment summary visible.<br>A4.3 The use case returns to Step 6. |
| A5: At any point, the officer leaves the page<br>A5.1 The system stops the current view interaction without changing stored assessment data.<br>A5.2 The use case ends. |

### Messages

| ID | Message |
|---|---|
| M1 | You are not authorised to view this assessment. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Authority scope and least-privilege evidence access must be enforced. |
| C2 | The page must distinguish current, processing, failed, incomplete, stale, and legacy records. |
| C3 | Viewing an assessment does not equal approval, confirmation, or resource deployment. |

## UC-M2-16-View-Resource-Recommendation

| Field | Details |
|---|---|
| Use Case Name | UC-M2-16-View-Resource-Recommendation |
| Description | Allows an authorised Authority Officer to view the current safety-resource recommendation, including baseline quantities/ranges, assumptions, rationale, contextual factors, version information, confidence, and whether authority review is required. |
| Trigger | The Authority Officer opens the resource-recommendation page or selects an event’s recommendation. |
| Precondition | 1. The Authority Officer is authenticated and assigned to the relevant scope.<br>2. The event and current resource record can be identified. |
| Postcondition | 1. The current authorised recommendation or a safe unavailable/error state is displayed.<br>2. No quantity is overridden by this Smart Risk Assessment and Safety Resource Recommendation Module viewing use case. |

### Basic Flow

| Actor | System |
|---|---|
| 1. The Authority Officer opens View Resource Recommendation. [FR-M2-13] [FR-M2-14] |  |
|  | 2. The system verifies authentication, active authority profile, and event scope. [A1] [FR-M2-14] |
|  | 3. The system loads the current event, linked assessment state, and resource-recommendation record. [A2] [FR-M2-13] [FR-M2-14] |
|  | 4. The system verifies that the recommendation belongs to the current submitted input and supported resource configuration. [A3] [FR-M2-14] |
|  | 5. The system displays each resource type with baseline quantity/range, rationale, assumptions, applied contextual factors, guideline/configuration version, confidence, and review-required status. [FR-M2-11] [FR-M2-12] [FR-M2-13] [FR-M2-14] |
| 6. The Authority Officer reviews the recommendation and expands item-level rationale/provenance as needed. [FR-M2-12] [FR-M2-14] |  |
|  | 7. The system displays any existing separately authorised override provenance as reference without allowing Smart Risk Assessment and Safety Resource Recommendation Module to create a new override. [FR-M2-14] |
| 8. The Authority Officer leaves the page or selects another recommendation. |  |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Officer is unauthenticated or outside scope<br>A1.1 At Step 2, the session/profile/scope check fails.<br>A1.2 The system displays M1: “You are not authorised to view this resource recommendation.”<br>A1.3 The use case ends. |
| A2: Recommendation is processing, absent, or failed<br>A2.1 At Step 3, no current recommendation exists.<br>A2.2 The system displays processing, unavailable, or failed/retryable status and the available assessment state.<br>A2.3 The officer may refresh; otherwise the use case ends. |
| A3: Legacy or stale recommendation is detected<br>A3.1 At Step 4, the record belongs to another input/configuration or uses an unsupported shape.<br>A3.2 The system labels it legacy/stale and does not present quantities as current.<br>A3.3 The use case ends or offers the authorised recalculation route. |
| A4: Item has unavailable/review-required status<br>A4.1 At Step 5, one item lacks a defensible quantity/range or requires human validation.<br>A4.2 The system displays the status and reason instead of showing a fabricated default.<br>A4.3 The use case returns to Step 6. |
| A5: At any point, the officer leaves the page<br>A5.1 The system stops the view interaction without changing recommendation data.<br>A5.2 The use case ends. |

### Messages

| ID | Message |
|---|---|
| M1 | You are not authorised to view this resource recommendation. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | The recommendation must be visibly labelled as planning guidance, not confirmed deployment. |
| C2 | The view must retain item-level assumptions and version/provenance information. |
| C3 | Resource overrides and authority decisions remain outside this Smart Risk Assessment and Safety Resource Recommendation Module viewing use case. |

## UC-M2-17-View-AI-Assisted-Analysis

| Field | Details |
|---|---|
| Use Case Name | UC-M2-17-View-AI-Assisted-Analysis |
| Description | Allows an authorised Admin to view the validated AI-assisted analysis, model/prompt/schema provenance, evidence references, processing status, and any unavailable/invalid/retryable state associated with the current submitted event input. |
| Trigger | The Admin opens the AI-assisted analysis view for an event assessment. |
| Precondition | 1. The Admin is authenticated and authorised to view the selected event and AI-analysis details.<br>2. The event and current assessment input can be identified. |
| Postcondition | 1. Validated AI-assisted analysis or an explicit failure/unavailable state is displayed.<br>2. Viewing does not modify the protected assessment result or authority decision. |

### Basic Flow

| Actor | System |
|---|---|
| 1. The Admin opens View AI-Assisted Analysis. [FR-M2-13] [FR-M2-14] |  |
|  | 2. The system verifies the Admin’s authentication, role, account status, and event access. [A1] [FR-M2-14] |
|  | 3. The system loads the current event/assessment reference and linked AI-analysis record/status. [A2] [FR-M2-13] [FR-M2-14] |
|  | 4. The system verifies the AI record’s submitted-input, model, prompt, and response-schema versions. [A3] [FR-M2-09] [FR-M2-14] |
|  | 5. The system displays the accepted structured analysis, evidence references, key concerns/contextual observations, AI status, timestamps, and provenance. [FR-M2-13] [FR-M2-14] |
| 6. The Admin reviews the analysis and may inspect referenced evidence permitted by access control. [FR-M2-13] [FR-M2-14] |  |
|  | 7. The system keeps AI content visibly distinguished from protected assessment and authority-decision information. [FR-M2-14] |
| 8. The Admin leaves the page or selects another event. |  |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Admin is unauthenticated or unauthorised<br>A1.1 At Step 2, authentication, role, account, or scope validation fails.<br>A1.2 The system displays M1: “You are not authorised to view this AI-assisted analysis.”<br>A1.3 The use case ends. |
| A2: AI analysis is unavailable, invalid, or retryable<br>A2.1 At Step 3, no accepted analysis exists and UC-M2-13 stored a failure state.<br>A2.2 The system displays the safe status, failure category, last attempt time, and whether recalculation/retry is available.<br>A2.3 The system does not display rejected raw AI output as accepted analysis.<br>A2.4 The use case ends or returns to Step 3 after an authorised refresh. |
| A3: AI record is stale or belongs to another input/version<br>A3.1 At Step 4, the AI record does not match the current submitted input or supported contract versions.<br>A3.2 The system labels the record stale/legacy and prevents it from appearing as current analysis.<br>A3.3 The use case ends. |
| A4: Referenced evidence is restricted or unavailable<br>A4.1 At Step 6, an evidence reference cannot be accessed.<br>A4.2 The system displays a restricted/unavailable indicator while keeping the authorised analysis summary visible.<br>A4.3 The use case returns to Step 5. |
| A5: At any point, the Admin leaves the page<br>A5.1 The system stops the view interaction without modifying AI or assessment records.<br>A5.2 The use case ends. |

### Messages

| ID | Message |
|---|---|
| M1 | You are not authorised to view this AI-assisted analysis. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Only responses accepted by the configured validation contract may be displayed as valid AI-assisted analysis. |
| C2 | AI content must be visually and semantically distinguished from authority decisions. |
| C3 | Raw secrets, provider credentials, and unnecessary sensitive request data must never be displayed. |

## UC-M2-18-View-Assessment-Summary

| Field | Details |
|---|---|
| Use Case Name | UC-M2-18-View-Assessment-Summary |
| Description | Allows an authorised Event Organiser to view a role-appropriate summary of the submitted event assessment. The summary communicates the current risk level, main hazards, assessment status, required organiser actions, and safety-resource planning information without exposing restricted evidence, internal validation details, AI prompts, private assessment information, or authority-only decision records. |
| Trigger | The Event Organiser opens the assessment-summary page for a submitted event. |
| Precondition | 1. The Event Organiser is authenticated and the requested event is within the organiser’s permitted scope.<br>2. A current assessment or an explicit processing/unavailable/review-required status can be identified. |
| Postcondition | 1. The system displays an organiser-safe assessment summary or a safe processing/unavailable/error state.<br>2. The view does not expose restricted evidence, internal validation details, AI prompts, or authority-only information.<br>3. Viewing does not modify the assessment or create an authority approval/rejection decision. |

### Basic Flow

| Actor | System |
|---|---|
| 1. The Event Organiser opens View Assessment Summary. [FR-M2-13] [FR-M2-14] |  |
|  | 2. The system verifies the organiser’s authentication, role, account status, and event scope. [A1] [FR-M2-14] |
|  | 3. The system loads the current event summary, assessment status, risk output, and resource-planning summary. [A2] [FR-M2-13] [FR-M2-14] |
|  | 4. The system verifies that the records belong to the requested submitted event and builds the permitted organiser-safe projection. [A3] [FR-M2-14] |
|  | 5. The system displays the current risk level, main hazards/concerns, required organiser actions, missing-information indicators, assessment status, and safe resource-planning summary. [A4] [FR-M2-13] [FR-M2-14] |
| 6. The Event Organiser reviews the displayed assessment summary. [FR-M2-13] [FR-M2-14] |  |
|  | 7. The system keeps restricted evidence, internal validation details, AI prompts, private assessment information, and authority-only records hidden. [FR-M2-14] |
| 8. The Event Organiser leaves the page or selects another event. |  |
|  | 9. The use case ends. |

### Alternative Flow

| Alternative Flow |
|---|
| A1: Organiser is unauthorised or outside scope<br>A1.1 At Step 2, authentication, account, role, or event-scope validation fails.<br>A1.2 The system displays M1: “You are not authorised to view this assessment summary.”<br>A1.3 The use case ends. |
| A2: Assessment is processing, unavailable, failed, or absent<br>A2.1 At Step 3, no current completed assessment summary exists or the assessment is still processing.<br>A2.2 The system displays the permitted processing, unavailable, failed, or review-required status without inventing a risk result.<br>A2.3 The Event Organiser may refresh or leave the page; otherwise the use case ends. |
| A3: Assessment record is stale or belongs to another input<br>A3.1 At Step 4, the record does not match the current submitted event input or supported assessment configuration.<br>A3.2 The system labels the record stale/legacy and does not present it as the current assessment summary.<br>A3.3 The use case ends or offers the permitted refresh route. |
| A4: Safe projection cannot be created or a restricted field is requested<br>A4.1 At Step 5, the safe projection is unavailable or the requested content requires authority-only access.<br>A4.2 The system displays the permitted summary fields and a restricted/unavailable indicator instead of exposing protected details.<br>A4.3 The Event Organiser may continue reviewing the safe fields; otherwise the use case ends. |
| A5: At any point, the Event Organiser leaves the page<br>A5.1 The system stops the view interaction without changing assessment, resource, evidence, or authority-decision records.<br>A5.2 The use case ends. |

### Messages

| ID | Message |
|---|---|
| M1 | You are not authorised to view this assessment summary. |

### Constraints

| ID | Constraint |
|---|---|
| C1 | Only the organiser-safe projection may be displayed to the Event Organiser. |
| C2 | The summary must not expose restricted evidence, internal validation details, AI prompts, private assessment information, or authority-only decisions. |
| C3 | The summary communicates planning and required actions; it is not an authority approval or rejection. |
