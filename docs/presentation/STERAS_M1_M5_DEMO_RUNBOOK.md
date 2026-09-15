# STERAS M1–M5 Presentation Runbook

## Demonstration scenario

- **Event:** Malaysia Tourism Storytelling Showcase 2026
- **Application ID:** `iTpN6WjUEKtgQFWEliE1`
- **Venue:** KLCC Convention Centre, Kuala Lumpur
- **Format:** Indoor seated concert and cultural storytelling showcase
- **Expected attendance:** 600
- **Application version:** v1

The names and supporting files in this scenario are realistic, fictitious demonstration records. They are not government-issued approvals and must not be presented as such.

## Suggested 8–10 minute presentation

### 1. M1 — application preparation and submission

Sign in as `organizer1@steras.test` and open **My Events → Malaysia Tourism Storytelling Showcase 2026**.

Show:

- scenario and venue-setting recommendation;
- the combined Core + scenario application upload;
- document preview and automatic field extraction;
- completion progress, suspicious/missing-field checks, and evidence mapping;
- the verified KLCC venue binding and immutable submitted v1.

Talking point: the organiser reviews every extracted field before submission. The demonstration schedule was adjusted to the live presentation window during this review step.

### 2. M2 — contextual risk and resources

Open the current assessment from the application detail.

Show:

- successful MiniMax numeric proposal across all eight hazard categories;
- live OpenWeather context and evidence provenance;
- deterministic validation and hard-rule floors;
- official score **28 / Medium** after four authority reviews;
- seven deterministic planning resources, with prototype-source wording and planning ranges.

Key resource result:

| Resource | Baseline | Planning range |
|---|---:|---:|
| Police | 3 | 3–4 |
| Security personnel | 12 | 12–15 |
| Medical teams | 1 | 1–2 |
| Ambulances | 1 | 1–2 |
| Fire officers | 3 | 3–4 |
| Toilets | 20 | 20–25 |
| Waste bins | 6 | 6–8 |

Talking point: MiniMax proposes; validation, hard rules, scoring, provenance, and resource quantities remain deterministic and auditable.

### 3. M3 — coordinated approval and event controls

Sign in as `steras-admin@steras.test`.

Show:

- Admin initial review;
- one assigned reviewer each from PDRM, BOMBA, KKM, and DBKL;
- four append-only eight-category score reviews;
- unanimous officer recommendations and Admin second approval;
- the MiniMax-proposed, Admin-published four-item event control list;
- 13 Stage 1 documents verified and four sanitized Stage 2 public evidence items.

Talking point: officer recommendations never directly publish the event. Admin second review is the final application decision boundary.

The M3 report action and M4 incident creation use the same event-window rule, so a report cannot create an orphaned pre-event ticket.

### 4. M4 — incident response

Open **Incidents** and select the showcase incident.

Show:

- an event-window incident linked to the current approved event;
- MiniMax severity and immediate-action assessment;
- organizer assignment, response note, and append-only resolution history;
- the confirmed discrepancy becoming eligible for analytics while the incorrect public evidence is withdrawn and the control moves to `resubmit_required`.

Talking point: resolving the incident does not silently restore bad evidence. The organiser must submit a corrected Stage 2 image for a fresh Admin publication decision.

### 5. M5 — privacy-safe analytics

Open **Reports**.

Show:

- Report 01 for risk and incident signals;
- Report 03 for assessment quality;
- Report 04 for resource planning;
- Report 05 for event-control compliance;
- CSV/PDF export controls, source coverage, metric definitions, and `Data Not Available` semantics.

Talking point: the report reads the latest valid records only and excludes organiser contact details, private evidence paths, incident descriptions, and internal authority notes.

## Demo accounts

| Role | Account |
|---|---|
| Organizer | `organizer1@steras.test` |
| Admin | `steras-admin@steras.test` |
| PDRM reviewer | `pdrm.showcase@steras.test` |
| BOMBA reviewer | `bomba.showcase@steras.test` |
| KKM reviewer | `kkm.showcase@steras.test` |
| DBKL reviewer | `dbkl.showcase@steras.test` |
| Public viewer | `public1@steras.test` |

Use the team-managed demonstration password. It is intentionally excluded from this repository.

## Presentation recovery

- If a live service is slow, use the approved application page and the screenshots in `output/playwright/production-m1-m5/`.
- Do not regenerate the control list during the presentation; load the cached proposal instead.
- Do not edit or re-submit v1. The submitted application, assessments, reviews, resources, and controls are audit records.
- The production recovery export is stored in the restricted Firebase backup location, not in the presentation pack.
