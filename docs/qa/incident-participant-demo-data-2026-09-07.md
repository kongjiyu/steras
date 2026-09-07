# Participant incident workflow and demo data

## Implemented behavior

- Only a signed-in participant (`public` role) can submit an incident report.
- Organizers can review and act on reports for their own events.
- Authority officers can review and investigate reports assigned to their exact account and authority type.
- Admin retains authority-directory administration without incident review access.
- The participant event selector contains only approved events that have started and are ongoing or ended within the past seven days. The backend repeats the same validation during submission.
- The participant form uses the ten requested incident categories with user-facing labels.

## Managed demonstration dataset

Dataset ID: `steras-presentation-portfolio-2026-09-v1`.

The managed dataset contains 17 events and 17 incidents. Five approved events are scheduled relative to the seed execution time so the incident form always has usable records:

1. Two ongoing events, started two and five hours before seeding.
2. Three recently completed events, started one, four and seven days before seeding.

The five participant scenarios contain two incidents each and cover every requested category. All records carry `synthetic: true` or the dataset ownership marker. Re-applying replaces only records owned by this dataset; it refuses to delete a colliding record without the matching marker.

| Module | Seeded data |
|---|---|
| M1 | Event applications, versions, application evidence, venue and organizer details |
| M2 | Context snapshots, category assessments, authority score reviews and resource recommendations |
| M3 | Initial review, authority assignments and decisions, event controls, Stage 1 documents and Stage 2 evidence |
| M4 | Participant reports, ten categories, severities, workflow states, evidence and append-only history |
| M5 | A sufficiently varied portfolio for status, risk, resources and incident analytics |

## Commands

Preview without writes:

```bash
npm --workspace functions run seed:presentation-portfolio -- --dry-run --project linkos-496505
```

Apply the managed dataset:

```bash
npm --workspace functions run seed:presentation-portfolio -- --apply --project linkos-496505 --confirm linkos-496505
```

Verify schema, artifacts, count, reportable window and category coverage:

```bash
npm --workspace functions run seed:presentation-portfolio -- --verify --project linkos-496505
```

## Acceptance evidence

Focused tests cover participant-only submission, organizer/authority action ownership, future/old event rejection, exact category labels, and admin separation. Production verification must confirm the participant selector shows five eligible events and that organizer/authority pages do not show the submission form. A real participant submission should use clearly synthetic text and should be removed or retained as labeled demo evidence according to the presentation plan.
