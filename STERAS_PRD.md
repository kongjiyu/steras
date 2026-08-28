---
title: STERAS — Product Requirements Document
course: BMSE3004 Collaborative Development
project: Smart Tourism Event Risk Assessment System
version: 5.0
status: Final
date: 2026-08-12
source_of_truth:
  - Team-confirmed final functional requirements supplied on 2026-08-12
  - FR-M1-01 to FR-M1-21
  - FR-M2-01 to FR-M2-14
  - FR-M3-01 to FR-M3-32
  - FR-M4-01 to FR-M4-18
  - FR-M5-01 to FR-M5-20
---

# STERAS — Product Requirements Document

## 1. Product overview

The **Smart Tourism Event Risk Assessment System (STERAS)** is a web-based
system for managing tourism-event applications, AI-assisted and deterministic
risk assessment, authority review, event-control verification, incident
handling, and administrative analytics.

STERAS supports the complete flow from organiser registration and event
application submission through risk assessment, authority decision,
event-control publication, incident resolution, and privacy-safe reporting.

## 2. Requirements authority and scope

This PRD is based exclusively on the team-confirmed final functional
requirements supplied on **12 August 2026**.

- The functional requirements in Section 5 are normative.
- The supporting sections of this PRD summarise and organise those requirements
  without replacing or changing them.
- Where a supporting statement conflicts with a numbered functional
  requirement, the numbered functional requirement takes precedence.
- Functional-requirement identifiers remain module-specific traceability keys
  and must not be renumbered globally.

The confirmed system consists of five modules:

| Module | Responsibility |
|---|---|
| M1 — User and Event Management | Authentication and account control; event-application creation and versioning; evidence and venue management; application status and withdrawal; public approved-event calendar. |
| M2 — Smart Risk Assessment and Safety Resource Recommendation | Contextual evidence and provenance; MiniMax M3 hazard and score proposals; deterministic provisional and official risk calculation; safety-resource planning; role-restricted assessment outputs. |
| M3 — Authority Approval and Notification | Admin and authority-officer reviews; manual assessment; decisions and feedback; officer assignment; event-control generation, verification and publication; resource overrides. |
| M4 — Incident Reporting Module | Incident submission; AI-assisted severity assessment; organiser response; external-authority referral and investigation; resolution, history and Event Control discrepancy outcomes. |
| M5 — Analytics and Reporting | Admin-only, read-only generation, display and export of privacy-safe analytical reports. |

## 3. Users and access boundaries

| Actor | Confirmed responsibilities |
|---|---|
| Event organiser | Register and authenticate; create, edit, submit, cancel or withdraw owned applications; manage templates, venues and evidence; revise rejected applications; upload event-control documentation; receive results and handle assigned incidents. |
| Administrator / Admin | Create restricted user accounts; manage venues; perform initial, second and manual reviews; approve or reject applications; assign authority officers; modify and publish event controls; access M5 reports. |
| Authority user / Authority officer | Authenticate under an administrator-created account; review assigned applications; approve or reject with the required confirmation or feedback; verify Stage 1 documentation; override resource recommendations; investigate referred incidents. |
| Registered reporter | Submit eligible event-related incident reports and track their progress and final resolution. |
| Registered public viewer | Confirm a published Stage 2 image or report it as inaccurate. |
| Public viewer | View only approved and sanitised event and event-control information made public by the system. |
| MiniMax M3 | Provide structured hazard and score proposals for M2 and generate a proposed event-control list for M3. |

Access is role-based. Private evidence, organiser personal information,
restricted risk information, internal review details, incident details, and
other protected records must only be exposed where a functional requirement
explicitly permits access.

## 4. Core workflow and module boundaries

### 4.1 Event application and assessment

1. M1 authenticates the user and manages creation of the Draft application,
   template upload, extracted information, supporting evidence, venue, and
   submitted application version.
2. A valid submission enters **Submitted and Pending Review**.
3. M2 retrieves relevant contextual evidence and records its provenance.
4. MiniMax M3 proposes hazards, likelihood, severity, evidence references,
   rationale, confidence, concerns, and missing-information indicators.
5. M2 validates the AI response and applies configured hard-rule constraints.
6. M2 deterministically calculates a provisional risk result.
7. M3 performs the required human reviews and supplies confirmed or overridden
   scores.
8. M2 deterministically recalculates and stores the official risk result.
9. M2 generates safety-resource baselines and planning ranges.

MiniMax M3 is advisory in the assessment flow. It does not make the final
application decision.

### 4.2 Review and application decision

1. M3 performs the initial review after the M2 assessment is complete, or
   receives the application with **Manual Review Required** when AI-assisted
   assessment is unavailable.
2. The Admin may approve or reject during initial and second review.
3. Assigned authority officers review only applications assigned to them and
   record their approval or rejection.
4. Rejection requires a reason and suggestion. M1 preserves the rejected
   version and allows the organiser to revise and submit a new version.
5. M3 notifies the organiser after the Admin makes the final decision.

### 4.3 Withdrawal

- M1 changes an eligible application to **Withdrawn**, preserves its previous
  status and history, removes it from the public event calendar, and publishes
  the withdrawal status to M3 and M4.
- M3 closes pending reviews and event-control activities, unpublishes public
  event-control information, and retains existing records for audit.
- M4 applies the resulting access restrictions when determining whether a new
  incident can be submitted.

### 4.4 Event controls and public verification

1. After approval, M3 sends the approved application, official risk assessment,
   resource recommendations, and relevant rules or guidelines to MiniMax M3.
2. MiniMax M3 generates a proposed event-control list.
3. The Admin may modify the list.
4. The organiser uploads the required Stage 1 and Stage 2 documentation.
5. Assigned officers verify or reject Stage 1 documentation.
6. The Admin publishes permitted sanitised control documentation and selected
   event-control items.
7. Registered public viewers may confirm a published Stage 2 image or report it
   as inaccurate.
8. An inaccurate report is directed to M4. After resolution, M4 notifies M3
   that the outcome can be retrieved.
9. M3 requires resubmission when the discrepancy is Confirmed True and restores
   the documentation to Approved when it is dismissed as false.

### 4.5 Incident handling and analytics

1. M4 accepts reports for an ongoing event or an event completed within the
   previous seven days.
2. M4 stores the report and performs an AI-assisted severity and
   immediate-action assessment.
3. The Event Organiser handles the incident internally or requests external
   assistance.
4. Assigned authority officers investigate referred incidents.
5. The Event Organiser records the final resolution and closes the incident.
6. Closed and verified incident information is available to future M2
   assessments.
7. M5 reads the latest valid records from source modules to generate
   privacy-safe reports and never modifies source records.

## 5. Functional requirements

The following **105 functional requirements** constitute the confirmed
baseline.

### M1 — User and Event Management

The module manages organiser authentication, event application versions, evidence submission, application status, and the public approved-event calendar.

#### Organiser template-guided application flow

For FR-M1-04 to FR-M1-10, the organiser experience follows this sequence: (1) choose the event scenario, (2) receive a template recommendation, (3) preview the complete recommended documents, (4) review scenario-based supporting-document guidance, (5) start the Draft application, (6) complete one Core document and one scenario-specific document and provide the applicable supporting evidence, (7) allow STERAS to extract and auto-fill application fields, (8) review and correct the extracted information and validation warnings, and (9) confirm the application for administrative review.

The recommendation asks for exactly one event category and one venue setting. The five categories are Entertainment and Performance; Sports and Recreational; Cultural, Heritage and Festival; Exhibition, Convention and Promotional; and Carnival and Public Celebration. The three venue settings are Indoor, Outdoor fixed-site, and Outdoor route-based. Every combination maps to exactly one versioned scenario template, and every application also requires the common Core Event Application Template. Before starting the Draft, the organiser can preview every page of both documents, download both editable Word files, and review the Core and conditional scenario evidence guidance. Conditional evidence is presented as guidance at recommendation time and becomes required only when the corresponding application condition applies. The selected template IDs, versions and registry version are preserved with the Draft and submitted application version. The organiser may change the selection while the application remains editable and before a completed template is uploaded.

| ID | Functional Requirement |
|---|---|
| FR-M1-01 | The system shall allow registered organisers, authority users, and administrators to log in and log out, and shall provide access to system functions according to their assigned roles. The system shall allow new users to register where registration is permitted. |
| FR-M1-02 | The system shall allow a new event organiser to register an account by providing the required account and profile information. |
| FR-M1-03 | The system shall restrict the creation of authority-user and administrator accounts to authorised administrators. |
| FR-M1-04 | The system shall allow an organiser to create a new event application by selecting an appropriate event application in Draft status and shall allow the organiser to save, reopen, and continue editing the Draft application before submission |
| FR-M1-05 | The system shall allow an organiser to change the selected event application template before uploading the completed template document. |
| FR-M1-06 | The system shall allow an organiser to upload a completed event application template and validate that the uploaded file is in a supported format. |
| FR-M1-07 | The system shall extract relevant event information from the uploaded template, map the extracted information to the corresponding application fields, and generate an auto-filled application form. |
| FR-M1-08 | The system shall allow the organiser to review and edit the auto-filled application information before submission. |
| FR-M1-09 | The system shall allow an organiser to upload, view, replace, and remove supporting evidence while the application is in an editable status. |
| FR-M1-10 | The system shall verify that all required application information and supporting evidence are complete before allowing the organiser to submit the application. |
| FR-M1-11 | The system shall submit a valid application and change its status to Submitted and Pending Review, while preserving the submitted application version for review and application history. |
| FR-M1-12 | The system shall allow an organiser to edit an application while it is Submitted and Pending Review and before admin review begins, returning the application to an editable Draft state before resubmission. |
| FR-M1-13 | The system shall allow an organiser to cancel an application while its status is Submitted and Pending Review, before admin review has begun, and shall change the application status to Cancelled. |
| FR-M1-14 | The system shall remove the event from the public event calendar, retain the application and withdrawal history for audit purposes, and publish the withdrawal status to the Authority Approval and Notification Module and the Incident Reporting Module for downstream closure and access enforcement when an application is withdrawn. |
| FR-M1-15 | The system shall allow an organiser to withdraw an eligible application after admin review has begun and shall change the application status to Withdrawn  while preserving its previous status and history. |
| FR-M1-16 | The system shall allow an organiser to revise a Rejected application or template based on the recorded rejection reason and suggestion, review the corrected information, and submit a new application version for review while preserving the previously rejected version and review history |
| FR-M1-17 | The system shall display the organiser’s applications together with their current status, submitted version, assessment availability, admin decision, correction details, and publication state. |
| FR-M1-18 | The system shall notify the administrator when a new event application or edited application is submitted for review. |
| FR-M1-19 | The system shall display a public event calendar containing only approved and sanitised event information, without exposing organiser personal information, private evidence, risk details, incidents, or complaints. |
| FR-M1-20 | The system shall allow an organiser to select an event venue from the venue database. If the required venue is unavailable, the system shall allow the organiser to provide a custom venue name, address, state, and other required location information. |
| FR-M1-21 | The system shall allow an authorised administrator to create, update, verify, deactivate, and view venues in the venue database. |

### M2 — Smart Risk Assessment and Safety Resource Recommendation

The module owns contextual evidence retrieval, deterministic risk assessment, advisory AI analysis, safety-resource planning, and assessment outputs for other modules.

| ID | Functional Requirement |
|---|---|
| FR-M2-01 | The system shall retrieve weather, public-holiday, venue, calendar, historical-event outcome, and closed and verified incident information supplied by the Incident Reporting Module that is relevant to the submitted event application. |
| FR-M2-02 | The system shall record the source, retrieval time, eligibility, synthetic-data indicator, and other provenance details for each contextual evidence item used in an assessment. |
| FR-M2-03 | The system shall validate whether the submitted event application contains sufficient evidence and required information before determining its assessment readiness, compliance status, and evidence-confidence level. |
| FR-M2-04 | The system shall send validated event data, contextual evidence, the active category rubric, configured hard rules, and relevant guidance to MiniMax M3 for structured hazard identification and category assessment. |
| FR-M2-05 | MiniMax M3 shall identify relevant hazards and propose a likelihood score, severity score, evidence references, rationale, confidence level, concerns, and missing-information indicators for each applicable assessment category. |
| FR-M2-06 | The system shall validate the MiniMax response against the required JSON schema, permitted categories, scoring ranges, available evidence references, configured hard rules, and the active assessment rubric. |
| FR-M2-07 | The system shall apply configured hard-rule constraints and deterministically calculate a provisional category and overall risk result from the validated AI-proposed likelihood and severity scores. After receiving authority-confirmed or overridden scores from the Authority Approval and Notification Module, the system shall deterministically recalculate and store the official category and overall risk result using the active formula, weights, thresholds, and guideline checks. |
| FR-M2-08 | The system shall record validation warnings for missing evidence, unsupported evidence references, invalid calculations, rubric conflicts, low-confidence outputs, and material differences between AI-proposed scores and hard-rule constraints, and shall mark affected assessments for authority review. |
| FR-M2-09 | The auditable assessment record shall retain the original AI-proposed scores, the provisional calculated result, each authority confirmation or override, the override reason, the confirming authority user, and the final official recalculated result without overwriting the original values. |
| FR-M2-10 | When MiniMax M3 is unavailable, times out, or returns invalid output, the system shall mark the AI-assisted assessment as unavailable or retryable and route the application to the Authority Approval and Notification module with a Manual Review Required status. The system shall not fabricate AI-generated category scores or explanations. |
| FR-M2-11 | The system shall generate baseline quantities and planning ranges for police, security, medical, ambulance, sanitation, waste-management, and fire-safety resources using the validated risk result, event characteristics, configured assumptions, and relevant guidelines. |
| FR-M2-12 | The system shall retain each resource baseline, recommended range, calculation assumption, guideline source, authority source, and provenance record used in the recommendation. |
| FR-M2-13 | The system shall present a consolidated assessment containing the AI-identified hazards, AI-proposed category scores, validated category risk values, calculated overall score and Low/Medium/High risk level, source evidence, validation warnings, confidence indicators, advisory explanations, assessment readiness, compliance status, and baseline safety-resource recommendations. |
| FR-M2-14 | The system shall provide organiser-safe assessment summaries and detailed authority assessment records according to role-based access restrictions, without exposing restricted evidence, internal validation details, AI prompts, or private assessment information to unauthorised users. |

### M3 — Authority Approval and Notification

The module manages assigned authority reviews, multi-agency decisions, control verification, resource overrides, publication, notifications, and decision auditing.

| ID | Functional Requirement |
|---|---|
| FR-M3-01 | The system shall close all pending authority reviews and event-control activities, unpublish any published event-control information, and retain all existing records for audit purposes when an event application becomes “Withdrawn”. |
| FR-M3-02 | The system shall allow the admin to perform an initial review of the event application after the Smart Risk Assessment and Safety Resource Recommendation have completed. |
| FR-M3-03 | The system shall allow the administrator to perform an initial review when the application has been transferred with a Manual Review Required status since the AI-assisted assessment is unavailable. |
| FR-M3-04 | The system shall allow an authorised administrator to complete and record the required manual assessment when an application is marked Manual Review Required, including the assessment inputs, rationale, administrator identity, date, and time. |
| FR-M3-05 | The system shall allow the admin to approve or reject the event application during the initial review and the second review. |
| FR-M3-06 | The system shall require both the admin and authority officers to enter a reason and a suggestion when rejecting the event application. |
| FR-M3-07 | The system shall allow the admin to attach the assigned authority officer's feedback when rejecting the event application. |
| FR-M3-08 | The system shall allow the admin to approve an application for authority review or reject it during the initial review, and to grant final approval or reject it during the second review. |
| FR-M3-09 | The system shall notify the event organizer of the rejection result together with the reason and suggestion when the application is rejected by the admin at the initial review or the second review. |
| FR-M3-10 | The system shall list all authenticated authority officers in a checklist for the admin to assign. |
| FR-M3-11 | The system shall default-check the authenticated authority officer in the checklist based on the state of the event's venue. |
| FR-M3-12 | The system shall allow the admin to modify the auto-generated checklist of default-checked authenticated authority officers. |
| FR-M3-13 | The system shall allow the admin to assign the event application to the selected authenticated authority officers by checking them in the checklist and clicking the "Assign" button. |
| FR-M3-14 | The system shall display the event applications to the assigned authority officer only. |
| FR-M3-15 | The system shall allow an assigned authority officer to review the submitted application, supporting evidence, provisional assessment, AI advisory explanation, and resource ranges, and to confirm or override the AI-proposed likelihood and severity scores with a recorded reason. |
| FR-M3-16 | The system shall allow an assigned officer to reject the event application which requires enter reason and suggestion. |
| FR-M3-17 | The system shall allow an assigned officer to approve the event application which requires ticking a checkbox confirming review of all listed materials. |
| FR-M3-18 | The system shall allow the admin to perform a second review of the event application after all assigned officers have completed their review. |
| FR-M3-19 | The system shall send the approved event application, official risk assessment, safety-resource recommendations, and relevant control rules or guidelines to MiniMax M3 to generate a proposed event control list. |
| FR-M3-20 | The system shall allow the admin to modify the event control list. |
| FR-M3-21 | The system shall allow the event organizer to upload the documentation required by the event control list. |
| FR-M3-22 | The system shall allow the admin to publish the sanitised event control documentation uploaded by the event organizer to public view. |
| FR-M3-23 | The system shall allow an assigned officer to verify Stage 1 event control documentation. |
| FR-M3-24 | The system shall allow an assigned officer to reject Stage 1 event control documentation and require the event organizer to re-submit. |
| FR-M3-25 | The system shall allow an authorised officer to override on the resource-planning recommendation with reason provided and record the original recommendation, revised quantity, officer ID, authority, date, and time for audit and reporting purposes. |
| FR-M3-26 | The system shall list Stage 1 and Stage 2 documentation requirements together at the time each control item is generated, so the event organizer sees the full submission scope upfront. |
| FR-M3-27 | The system shall allow the event organizer to mark a Stage 1 purchase receipt as "Use Previous" for items already procured without requiring a fresh upload or officer verification. |
| FR-M3-28 | The system shall allow any registered public viewer to confirm a published Stage 2 image as accurate or to report it as inaccurate. |
| FR-M3-29 | The system shall increase the confirmation counts and make it visible to the public when a public viewer confirms a published Stage 2 image as accurate. |
| FR-M3-30 | The system shall direct to the incident report module when public viewers report a published Stage 2 image as inaccurate. |
| FR-M3-31 | The system shall require the event organizer to resubmit the event control documentation if the report is confirmed true. |
| FR-M3-32 | The system shall update the state of the event control documentation back to approved if the report is dismissed as fake. |

### M4 — Incident Reporting Module

The module enables registered reporters to submit event-related incident reports, supports AI-assisted incident assessment and severity classification, coordinates incident handling by Event Organizers and external authorities, and maintains historical incident records for future event assessment and analytics.

| ID | Functional Requirement |
|---|---|
| FR-M4-01 | The system shall allow a registered reporter to submit an incident report for an ongoing event or an event completed within the past seven (7) days. Reportable incidents shall include, but are not limited to, crowd congestion or overcrowding, missing persons, lost-and-found matters, medical or safety incidents, security concerns, property or facility damage, suspicious activities, access or traffic-related issues, and discrepancies involving published Event Control items or their supporting evidence. |
| FR-M4-02 | The system shall require the reporter to provide the incident category, description, occurrence date and time, incident location, and supporting evidence where available, and shall automatically associate the report with the selected event and reporter account. |
| FR-M4-03 | When an incident report originates from a published Event Control item, the system shall retain a reference to the related Event Control item, published evidence, event, and originating report action so that the Authority Approval Module can be notified and retrieve the incident outcome after resolution. |
| FR-M4-04 | The system shall validate all mandatory incident-report fields, display appropriate validation messages for invalid or incomplete submissions, and store each successfully submitted incident report with a unique incident identifier, submission date and time, and initial status. |
| FR-M4-05 | The system shall perform an AI-assisted incident assessment using the incident category, description, event information, location, occurrence time, and available supporting evidence to determine the incident severity level and whether immediate action is required. |
| FR-M4-06 | The system shall store the AI assessment result, including the assigned severity level and immediate-action determination, with the corresponding incident record for subsequent review and audit purposes. |
| FR-M4-07 | The system shall notify the assigned Event Organizer of a newly submitted incident and indicate whether immediate action is required based on the AI-assisted incident assessment. |
| FR-M4-08 | The system shall allow the Event Organizer to review the incident report, AI assessment result, severity level, event information, supporting evidence, and linked Event Control information where applicable before determining the appropriate response. |
| FR-M4-09 | The system shall allow the Event Organizer to handle an incident internally by assigning an internal response team where necessary, recording response actions, uploading supporting evidence, and updating the incident handling status. |
| FR-M4-10 | When external assistance is required, the system shall recommend suitable authorities based on the incident category, severity level, event location, and event information, and display the relevant authority name, service category, coverage area, and contact information. |
| FR-M4-11 | The system shall allow the Event Organizer to request external assistance by selecting an appropriate recommended authority, recording the authority engagement details, and referring the incident to the selected authority for investigation. |
| FR-M4-12 | The system shall allow an assigned authority officer to review the referred incident, record investigation actions, upload supporting evidence, submit investigation findings, and record the investigation outcome. |
| FR-M4-13 | The system shall allow the Event Organizer to review the completed internal response or authority investigation outcome, as applicable, and record the final resolution before closing the incident. |
| FR-M4-14 | For an incident linked to a published Event Control item, the system shall require the Event Organizer to record whether the reported discrepancy is Confirmed True or Dismissed as False, based on the available evidence, response actions, and investigation findings, as part of the final resolution. |
| FR-M4-15 | After an Event Control-related incident has been resolved, the system shall notify the Authority Approval Module that the incident outcome is available for retrieval, while retaining the investigation result, evidence, response actions, and final resolution in the incident record. |
| FR-M4-16 | The system shall allow reporters to track the current incident status, response progress, authority investigation progress where applicable, and final resolution of their submitted incident reports. |
| FR-M4-17 | The system shall maintain a complete incident history including the original report, AI assessment result, severity classification, response actions, authority engagement and investigation findings where applicable, supporting evidence, Event Control discrepancy outcome where applicable, final resolution, status changes, responsible users, and timestamps for audit and future event assessment purposes. |
| FR-M4-18 | The system shall maintain an authority directory containing authority names, service categories, coverage areas, and contact information to support AI-assisted authority recommendation and external-assistance handling. |

### M5 — Analytics and Reporting

The module allows authenticated Admin users to generate, view, and export privacy-safe analytical reports. All report-generation activities are performed through the Admin interface. Other users must obtain required reports through the Admin and cannot directly access.

| ID | Functional Requirement |
|---|---|
| FR-M5-01 | The system shall restrict access to the Analytics and Reporting Module to authenticated Admin users. |
| FR-M5-02 | The system shall allow the Admin to select one of the available report types for generation. |
| FR-M5-03 | The system shall allow the Admin to generate the selected report using either the Overall analysis scope or the By Event Type analysis scope. |
| FR-M5-04 | When the Admin selects the By Event Type analysis scope, the system shall display the available event types and require the Admin to select one event type. |
| FR-M5-05 | The system shall generate an Event Risk and Incident Analysis Report presenting overall results or results for a selected event type, including official risk-level distributions, total incidents, events with incidents, incident percentages, average incidents per event, incident severity, immediate-action requirements, external-authority escalation and resolution outcomes. |
| FR-M5-06 | The system shall generate an Application Outcome and Rejection Analysis Report presenting overall results or results for a selected event type using application, assessment and review records. |
| FR-M5-07 | The Application Outcome and Rejection Analysis Report shall contain application counts and percentages by application status, official risk level and revision outcome. |
| FR-M5-08 | The Application Outcome and Rejection Analysis Report shall contain rejection counts and percentages by predefined rejection-reason category and review stage. |
| FR-M5-09 | The Application Outcome and Rejection Analysis Report shall contain the average, minimum and maximum processing durations for initial review, authority review, second review and the complete application process. |
| FR-M5-10 | The system shall generate a Risk Assessment Analysis Report presenting overall results or results for a selected event type, including official risk-level distributions, frequently identified hazards, dominant hazards, readiness results, compliance results, evidence-confidence levels, hard-rule adjustments and manual-review cases. |
| FR-M5-11 | The system shall generate a Safety Resource and Override Analysis Report presenting overall results or results for a selected event type, including recommended resource baselines, planning ranges, authority overrides, original and revised resource values, override rates and recorded override reasons. |
| FR-M5-12 | The Safety Resource and Override Analysis Report shall present available results for police, security, medical, ambulance, sanitation, waste-management and fire-safety resources. |
| FR-M5-13 | The system shall generate an Event Control Compliance Analysis Report presenting overall results or results for a selected event type, including the counts and percentages of control items that are pending submission, pending verification, verified, rejected with resubmission required or exempted through “Use Previous.” |
| FR-M5-14 | The system shall calculate report results using the latest valid records available from the relevant source modules. |
| FR-M5-15 | The system shall display each generated report using relevant summary values, tables and charts. |
| FR-M5-16 | The system shall generate available report sections, display “Data Not Available” for unavailable values or sections and shall not represent unavailable values as zero. |
| FR-M5-17 | The system shall allow the Admin to export a generated report in PDF or CSV format. |
| FR-M5-18 | The system shall include the report title, selected analysis scope, selected event type where applicable, generation date and data coverage period in each exported report. |
| FR-M5-19 | The system shall automatically exclude organiser personal information, private evidence paths, detailed incident descriptions, internal authority notes and other restricted information from generated reports and exported files. |
| FR-M5-20 | The system shall operate the Analytics and Reporting Module as a read-only function and shall not modify records maintained by the source modules. |

## 6. Data and integration requirements

### 6.1 Core data domains

| Data domain | Required information |
|---|---|
| Users and roles | Authentication identity, role, profile, account status, and administrator-controlled authority-user or administrator creation. |
| Venues | Venue name, address, state, required location details, verification state, and active/deactivated state. |
| Event applications | Selected template, uploaded template, extracted and edited fields, venue, supporting evidence, current status, and publication state. |
| Application versions and history | Draft and immutable submitted versions, rejected-version linkage, resubmission history, previous status, cancellation and withdrawal history. |
| Assessments | Contextual evidence and provenance, AI proposals, validation results, hard-rule constraints, provisional and official risk results, authority confirmations or overrides, resource recommendations, and audit information. |
| Reviews and decisions | Initial, authority, second and manual reviews; officer assignments; reasons, suggestions and feedback; final decisions; actor identities and timestamps. |
| Event controls | Proposed and modified control list, Stage 1 and Stage 2 requirements, uploaded documentation, verification state, Use Previous markers, sanitised public documentation, publication state, confirmation counts and discrepancy outcomes. |
| Incidents | Reporter and event linkage, category, description, occurrence information, evidence, AI assessment, organiser response, authority engagement, investigation, final resolution, status history and audit trail. |
| Authority directory | Authority name, service category, coverage area and contact information. |
| Reports | Report type, analysis scope, selected event type, source coverage period, calculated aggregates, charts/tables, privacy filtering and export metadata. |

### 6.2 Cross-module contracts

| Producer | Consumer | Confirmed output |
|---|---|---|
| M1 | M2 | Submitted event application version, venue information and supporting evidence. |
| M1 | M3 | Application status, submitted version and withdrawal status. |
| M1 | M4 | Event and withdrawal status needed for incident access enforcement. |
| M2 | M3 | Provisional/official assessment information, AI advisory explanation, validation warnings and safety-resource recommendations. |
| M3 | M2 | Authority-confirmed or overridden scores and associated audit provenance. |
| M3 | M4 | Event Control-linked inaccurate-report context. |
| M4 | M3 | Resolved Event Control discrepancy outcome and retrievable incident outcome. |
| M4 | M2 | Closed and verified incident information relevant to future assessments. |
| M1–M4 | M5 | Latest valid source records needed for read-only analytical reports. |

### 6.3 External and AI integrations

| Integration | Purpose |
|---|---|
| MiniMax M3 | Structured M2 hazard/category proposals and proposed M3 event-control list generation. |
| AI-assisted incident assessment | M4 severity classification and immediate-action determination; the final FR does not prescribe a named provider. |
| Contextual evidence sources | Weather, public-holiday, venue, calendar, historical-event outcome and relevant incident information. |
| File storage | Event-application templates, supporting evidence, event-control documentation and incident evidence. |
| PDF/CSV export | M5 administrative report export. |

Every contextual evidence item and assessment artifact must preserve the
provenance required by FR-M2-02, FR-M2-09 and FR-M2-12.

## 7. Quality, privacy and audit constraints

The confirmed functional requirements establish the following system-wide
constraints:

- Access to functions and information must follow assigned roles.
- Submitted application versions, rejected versions, withdrawal history,
  assessment inputs and outputs, review actions, overrides, control states,
  incidents and final resolutions must remain auditable.
- AI output must be validated where required and must not be fabricated when
  MiniMax M3 is unavailable or invalid.
- M2 official risk results must be deterministically recalculated from
  authority-confirmed or overridden scores.
- Public calendar, public event-control documentation, reports and exports must
  exclude restricted or private information.
- Unavailable report data must be displayed as **Data Not Available**, not
  represented as zero.
- M5 is read-only and must not modify source-module records.

## 8. Acceptance baseline

The system satisfies the final functional baseline when the following
end-to-end outcomes are demonstrable:

| Area | Acceptance outcome |
|---|---|
| Authentication and accounts | Permitted users can register or log in, role-based access is enforced, and restricted authority/admin accounts can only be created by authorised administrators. |
| Event application | An organiser can create and save a Draft, select/change a template, upload a supported document, review extracted data, manage evidence and venue information, and submit a complete application version. |
| Application lifecycle | Editing/cancellation before review, rejection and versioned resubmission, withdrawal and audit history behave according to M1 requirements. |
| Risk assessment | Context is retrieved with provenance; MiniMax returns structured proposals; M2 validates them, calculates provisional risk, and later calculates official risk from authority-confirmed or overridden scores. |
| AI failure | Invalid, timed-out or unavailable MiniMax output produces an unavailable/retryable assessment and a Manual Review Required handoff without fabricated AI scores or explanations. |
| Resource planning | Baselines, ranges, assumptions, guideline sources, authority sources and provenance are retained for all confirmed resource categories. |
| Authority review | Admin and assigned-officer reviews, required reasons/suggestions, feedback, manual review, second review and final-result notification are supported. |
| Event controls | MiniMax proposes the control list; Admin can modify it; organisers submit required documentation; officers verify/reject Stage 1; Admin publishes sanitised or selected public items. |
| Public Stage 2 feedback | A registered public viewer can confirm or report a published Stage 2 image, M4 resolves the linked discrepancy, and M3 applies the returned outcome. |
| Incident handling | Eligible incidents can be submitted, assessed, handled internally or externally, investigated, resolved, tracked and retained with complete history. |
| Analytics | Only authenticated Admin users can generate, view and export the confirmed privacy-safe reports for overall or selected-event-type scope. |
| Unavailable data and privacy | Reports exclude restricted information, show Data Not Available for unavailable content and do not change source records. |

## 9. Traceability summary

| Module | Confirmed FR range | Count | Primary PRD coverage |
|---|---:|---:|---|
| M1 — User and Event Management | FR-M1-01–FR-M1-21 | 21 | Sections 2–8 |
| M2 — Smart Risk Assessment and Safety Resource Recommendation | FR-M2-01–FR-M2-14 | 14 | Sections 2–8 |
| M3 — Authority Approval and Notification | FR-M3-01–FR-M3-32 | 32 | Sections 2–8 |
| M4 — Incident Reporting Module | FR-M4-01–FR-M4-18 | 18 | Sections 2–8 |
| M5 — Analytics and Reporting | FR-M5-01–FR-M5-20 | 20 | Sections 2–8 |
| **Total** | **FR-M1-01–FR-M5-20** | **105** | Final confirmed baseline |

---

**Final decision boundary:** MiniMax M3 provides AI-assisted outputs; M2
validates and deterministically calculates assessment results; authorised human
users in M3 own application review and decisions. M4 owns incident handling and
resolution. M5 provides read-only analytics.

---

## Change log

### v3.1 → v5.0 (this update, 2026-08-12 → 2026-08-16)

- **Version**: 3.1 (Final-source aligned draft) → 5.0 (Final)
- **Status**: aligned draft → Final
- **Date**: 2026-07-21 → 2026-08-12
- **Source of truth**: Updated from 3-module split (M1, M2, M3) to 5-module split (M1 User & Event Management, M2 Risk Assessment, M3 Authority Approval, M4 Incident Reporting, M5 Analytics & Reporting)
- **FR count**: 33 → 105. The duplicated `FR-M3-05` in the supplied v5.0 source was corrected by renumbering the second occurrence and subsequent M3 requirements through `FR-M3-32`.
- **Sections added** (vs v3.1):
  - §3 Users and access boundaries (new 7-actor table with confirmed responsibilities)
  - §4 Core workflow and module boundaries (5 sub-sections: application/assessment, review/decision, withdrawal, event controls, incident/analytics)
  - §5.3 M3 expanded to 32 FRs (from 7 in v3.1)
  - §5.4 M4 Incident Reporting Module — 18 FRs (new module)
  - §5.5 M5 Analytics and Reporting — 20 FRs (new module)
  - §6 Data and integration requirements (data domains + cross-module contracts + external/AI integrations)
  - §7 Quality, privacy and audit constraints
  - §8 Acceptance baseline (12 end-to-end outcomes)
  - §9 Traceability summary
- **Removed** (from v3.1):
  - Legacy "category profile" wording (the v5.0 M2 contract is now "all-hazards / HIRARC" with category-based assessment as the official terminology)
  - The "compliance / category / readiness / confidence" readiness/compliance terms as separate FRs (consolidated into FR-M2-03, FR-M2-08)
  - The single "lock contract" prototype review model (replaced by §4.2 review/decision flow with initial + second review)
- **Key M3 contract changes affecting this module's build queue**:
  - Withdrawn app → FR-M3-01 (close pending reviews, unpublish controls, retain records) — passive audit, no UI change
  - Manual review path → FR-M3-03 + FR-M3-04 (admin manual assessment) — **new admin page needed**
  - Officer assignment checklist → FR-M3-10 → FR-M3-14 (workload-based default-check per scope) — **new admin page needed**
  - Provisional/insufficient readiness → FR-M2-03 + FR-M2-08 (officer must record rationale) — **gap to fix in M3**
  - Blocked compliance → FR-M2-07 (must block approval) — **gap to fix in M3**
  - Event controls two-stage → FR-M3-23 → FR-M3-29 (Stage 1 officer verify + Stage 2 public confirm/report + Use Previous) — **new feature to build**
  - M4 outcome auto-update → FR-M3-31 + FR-M3-32 (trigger on `public_reports/{ticketId}.update`) — **new trigger to add**
  - Durable notifications → FR-M3-09 (rejection notify) + 16-row matrix (N1–N16) — **new collection to add**
