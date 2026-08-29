# STERAS M1 Presentation Test Case

## Scenario

Use this scenario to demonstrate the complete organizer flow:

- Event: **Malaysia Tourism Storytelling Showcase 2026**
- Category: **Entertainment and Performance Event**
- Venue setting: **Indoor**
- Recommended scenario template: **T01 - Entertainment and Performance Event - Indoor**
- Application reference: **STERAS-DEMO-T01-2026-001**

All people, registration numbers, suppliers and approvals in this pack are synthetic presentation data. Do not represent them as real identity, registration or approval records.

## Files to use

1. `01_Filled_Core_Event_Application_T01.docx` - completed Core template.
2. `02_Filled_T01_Indoor_Performance_Template.docx` - completed T01 template.
3. `03_Core_Supporting_Evidence_Pack.pdf` - one consolidated demonstration file that can be linked to all nine always-required Core evidence items.
4. `../pdf/m1-presentation-test-case/STERAS_DEMO_T01_Completed_Combined_Application.pdf` - completed Core and T01 forms merged into one searchable 17-page PDF for the combined-upload flow.

## Before the presentation

- Confirm that **Kuala Lumpur Convention Centre** is visible in the Verified venue registry and that its canonical capacity is **8,000**.
- If it is absent, create and verify that venue through the Admin venue flow before the presentation. Do not choose a custom venue if you intend to continue into the M2 automated-assessment flow, because a custom venue is treated as insufficient data.
- Sign in with an Organizer account and keep the combined application PDF and supporting-evidence PDF ready in Finder.

## Live flow

### 1. Template recommendation

On **Create application**:

1. Show the nine-step flow at the top.
2. Select **Entertainment and Performance Event**.
3. Select **Indoor**.
4. Show that STERAS recommends **T01** plus the mandatory **Core Event Application**.
5. Preview the Core and T01 templates using single-page and multi-page view.
6. Show the scenario supporting-document list, then continue to the application.

### 2. Upload and auto-fill

Choose **Upload one combined PDF**, then upload:

- `../pdf/m1-presentation-test-case/STERAS_DEMO_T01_Completed_Combined_Application.pdf`

Click **Extract and auto-fill**.

Expected result:

- **100% extracted** with no extraction warning.
- The form is populated with event name, description, venue address, attendance, start/end date and time, organizer name, email, phone, emergency-plan summary, venue capacity, and the five document-derived risk flags.
- STERAS verifies that the same PDF contains both `STERAS-CORE` and the recommended `STERAS-T01-ENT-IN-v2.0` scenario identity before accepting the extracted values.

### 3. Review the form fields

Use these final values:

| Section | Field | Value |
|---|---|---|
| Event | Event name | Malaysia Tourism Storytelling Showcase 2026 |
| Event | Event type | Concert |
| Venue | Verified venue registry | Kuala Lumpur Convention Centre |
| Venue | Venue name | Kuala Lumpur Convention Centre |
| Venue | Venue address | Kuala Lumpur Convention Centre, Kuala Lumpur City Centre, 50088 Kuala Lumpur, Malaysia |
| Venue | Venue capacity | 8000 |
| Venue | Latitude | 3.1530 |
| Venue | Longitude | 101.7130 |
| Event | Expected attendance | 600 |
| Event | Environment | Indoor |
| Event | Coverage | Covered |
| Event | Seating | Seated |
| Event | Start date and time | 2026-10-24 14:00 |
| Event | End date and time | 2026-10-24 18:00 |
| Event | Description | A seated indoor showcase combining Malaysian cultural storytelling and acoustic music in a controlled four-hour programme. |
| Organizer | Organizer name | Aina Rahman |
| Organizer | Email | aina.rahman@example.com |
| Organizer | Phone | +60 12-345 6789 |

Keep the extracted emergency-plan summary. It should contain crowd management, security, medical, evacuation and disruption arrangements from the Core document.

### 4. Complete the all-hazards profile

Set every declaration explicitly. Use these checked values:

- Crowd management plan declared
- Traffic management plan declared
- Severe weather plan declared
- Medical plan declared
- Evacuation plan tested

Leave these unchecked:

- International attendees expected
- Alcohol served
- Food served
- Free drinking water planned
- Ticketed entry or attendee registration
- Overnight accommodation involved
- Pyrotechnics or special effects
- Temporary stages or structures
- Rivalry or crowd tension expected
- Authority coordination confirmed

Numeric values:

- Vulnerable attendees estimate: **10%**
- Standing attendees estimate: **0%**
- Nearest hospital travel time: **10 minutes**

### 5. Link supporting evidence

Upload `03_Core_Supporting_Evidence_Pack.pdf` for **DOC-A01**. For the remaining eight Core items, choose the same already-uploaded file from the existing-evidence dropdown. The evidence counter should eventually show all 18 checklist items complete.

Link the PDF to these Core requirements:

- DOC-A01 - Venue Permission Letter
- DOC-A02 - Site or Layout Plan
- DOC-A03 - Location Map and Current Photographs
- DOC-B01 - Organiser Identification
- DOC-B02 - Organisation Registration Document
- DOC-C01 - Event Programme or Schedule
- DOC-C02 - Supplier and Contractor List
- DOC-D01 - Safety and Operational Plan
- DOC-D02 - Emergency and Evacuation Plan

The combined PDF is acceptable for this presentation because the UI permits one uploaded object to support multiple requirements. A real applicant should normally upload authentic evidence separately.

### 6. Mark T01 conditional evidence as not applicable

Choose **Not applicable** and enter the following reasons:

| Requirement | Reason |
|---|---|
| T01-DOC-01 | No foreign performers are involved in this event. |
| T01-DOC-02 | No pyrotechnics, flame, smoke, lasers or special effects are used. |
| T01-DOC-03 | The seated 600-person event is not classified as large-scale or high-crowd, and no extra authority evidence has been requested. |
| T01-DOC-04 | No temporary stage, platform, partition, truss or booth is installed. |
| T01-DOC-05 | No food or beverage vendor operates inside the performance venue. |
| T01-DOC-06 | No alcohol is sold, supplied or served at the event. |
| T01-DOC-07 | No drone operation is planned inside or above the venue. |
| T01-DOC-08 | The event has not been classified as high-risk or large-scale. |
| T01-DOC-09 | Admission is free and no ticketing or attendee registration is used. |

### 7. Submit and explain the result

1. Review the auto-filled sections horizontally and compare them with both DOCX files.
2. Confirm the evidence counter is **18 / 18 complete**.
3. Click **Submit application**.
4. Explain that STERAS creates an immutable submitted version and places the application into **Pending** for Admin review.
5. If continuing into M2, explain that only verified venue/evidence context is eligible to support automated risk assessment; organizer-declared controls do not silently reduce residual risk.

## Presenter talking points

- **Recommendation:** two answers choose one of 15 scenario templates while the Core template is always required.
- **Preview:** organizers know exactly what they must complete before starting.
- **Extraction:** one completed combined PDF populates the structured application, but the organizer still verifies every value.
- **Validation:** STERAS rejects a combined file whose Core or recommended scenario identity is missing or mismatched.
- **Evidence mapping:** one uploaded file can support multiple requirement IDs, and every conditional item needs evidence or a clear reason.
- **Integrity:** verified venue identity, exact capacity, Storage evidence and complete risk declarations are checked by the backend before submission.
