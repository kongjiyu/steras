# STERAS Team Documentation

This folder is the working entry point for the five module owners. `STERAS_PRD.md` v5.0 (Final, 105 functional requirements, 2026-08-12) is the only product source of truth. Module documents translate that PRD into implementation ownership, assumptions, interfaces, and page responsibilities.

## Read First

1. Read `../STERAS_PRD.md` for product requirements.
2. Read `GENERAL.md` for page ownership and integration rules.
3. Read only the document for your assigned module.
4. Use `STERAS_DESIGN_GUIDELINES.md` and `ASSET_GUIDE.md` when building UI.

## Ownership

| Area | Owner | Working document |
|---|---|---|
| General application, routing, shared UI, public landing, integration | M2 owner / project integrator | `GENERAL.md` |
| Current sprint goals and teammate handoffs | All module owners | `TEAM_GOALS.md` |
| 华语说明 + English keywords team handoff source | All module owners | `TEAM_PROGRESS_GOALS_BILINGUAL.md` |
| Individually shareable bilingual teammate handoffs | Individual module owners | `team-handoffs/` |
| M1 — User and Event Management | Module 1 teammate | `modules/M1_USER_EVENT_MANAGEMENT.md` |
| M2 — Smart Risk Assessment and Safety Resource Recommendation | M2 owner / project integrator | `modules/M2_SMART_RISK_AND_RESOURCES.md` |
| M3 — Authority Approval and Notification | Module 3 teammate | `modules/M3_AUTHORITY_APPROVAL_NOTIFICATIONS.md` |
| M4 — Incident Reporting and Handling | Module 4 teammate | `modules/M4_INCIDENT_REPORTING_HANDLING.md` |
| M5 — Analytics and Reporting | Module 5 teammate | `modules/M5_ANALYTICS_REPORTING.md` |

Replace “Module N teammate” with names after the team confirms assignments. Until then, ownership is by module number.

## Document Rules

- Each module has exactly one active working document.
- A route and its page file have exactly one owner.
- A page may consume another module's data or component without becoming jointly owned.
- Shared contracts live in `shared/types.ts`; contract changes require notifying every consumer.
- Module owners do not directly change another module's page. They provide a typed contract or reusable component to the page owner.
- Working assumptions in module documents are active implementation decisions. Change them through a documented version bump, not an undocumented rewrite.
- Historical phase reports and the superseded v2.1 PRD were removed because they described the obsolete baseline-plus-M3-adjustment architecture.

## Reference Documents

| Document | Purpose |
|---|---|
| `ARCHITECTURE.md` | Current architecture model, diagram, layer boundaries, and design principles |
| `STERAS_DESIGN_GUIDELINES.md` | Shared visual and interaction rules |
| `ASSET_GUIDE.md` | Asset usage and generation guidance |
| `BACKUP_RESTORE.md` | Firebase backup and recovery operations |
| `team-handoffs/M3_LEGACY_MIGRATION.md` | Linkos Module 3 legacy fixture migration, manifest, rollback and verification |
| `steras-design-language.png` | Visual direction reference |

## Quality Gate

Before handing work to another module owner, run from the repository root:

```bash
npm run check
npm run test:rules
```

The owner must also manually verify every route listed in their module document.

## M3 deployment gate

M3's deployed UAT must run against a dedicated staging Firebase project. The
Playwright global setup refuses the configured development/production project
and requires an explicit `STERAS_BASE_URL`, `STERAS_E2E_PROJECT_ID`, temporary
UAT password, and `STERAS_E2E_ALLOW_RESET=true`. Use the example environment
file at `frontend/.env.e2e.example` and the manual GitHub Actions workflow at
`.github/workflows/release-staging.yml`.

The release sequence is: deploy Functions, verify the required M3 function
IDs, run `migrate:m3 --dry-run`, apply the migration, deploy Firestore/Storage
rules, deploy Hosting, then run the smoke suite. The full suite is optional in
the workflow but required before promotion. Rules tests require Java 21 or
newer because Firebase CLI no longer supports the older local Java runtime.
