# Staging UAT Report

**Date:** 14 July 2026  
**Project:** `linkos-496505`  
**Hosting:** https://linkos-496505.web.app

## Release-Candidate Matrix

The deployed workflow was executed with isolated `@steras.test` accounts using `npm run uat:staging`. Every scenario creates an independent application and fails immediately when its expected status, version count, publication state, or assessment bounds are incorrect.

| Scenario | Event | Final status | Versions | Public |
|---|---|---:|---:|---:|
| Unanimous approval | `uat-approval-1784011049847-1f1eca77` | Approved | 1 | Yes |
| Rejection precedence | `uat-rejection-1784011073182-9027d69b` | Rejected | 1 | No |
| Amendment and resubmission | `uat-amendment-1784011082407-7f3fcfee` | Approved | 2 | Yes, v2 |
| Organizer withdrawal | `uat-withdrawal-1784011098326-d64d234e` | Withdrawn | 1 | No |

The three assessed scenarios completed with a schema-valid MiniMax M3 response. Final scores remained inside the server-enforced baseline-to-baseline-plus-15 bound.

## Golden Path

1. Organizer authenticated and submitted immutable version `v1`.
2. The cloud assessment pipeline completed in under 60 seconds.
3. MiniMax `MiniMax-M3` returned a schema-valid refinement.
4. The server calculated all seven resource quantities.
5. PDRM recorded an audited resource override.
6. PDRM, BOMBA, and KKM approved the same version.
7. Aggregate status advanced through `UnderReview`, `UnderReview`, and `Approved`.
8. A sanitized `public_events` record was published.

## Golden-Path Evidence

- Event: `uat-approval-1784011049847-1f1eca77`
- Baseline: `11`
- M3 adjustment: `0`
- Final score: `11 (Low)`
- AI status: `success`
- Final status: `Approved`
- Public record: present

Browser verification confirmed authority login routing, assigned-agency queue access, review details, resource provenance, and unanimous decision status. The completed review was inspected at desktop and `390 x 844`; no horizontal overflow or incoherent overlap was observed.

The current run includes a version-scoped PDF evidence file. An assigned PDRM user downloaded evidence successfully through Firebase Storage Rules, while an unassigned DBKL authority received no access to a private application.

Browser verification also confirmed:

- A valid organizer form submission created event `AZGDyqeVmv3hv3VwjIg7` and displayed its assessment without manual refresh.
- The approved event is available from its sanitized public URL.
- The rejected event returns `Event not publicly listed`.
- The amendment review shows v2 as current, preserves v1, and displays all five version-specific decision records.
- Desktop and `390 x 844` review views report zero console errors or warnings.

## Defects Found and Resolved

- Prompt v2.2 allowed M3 to return scalar `compoundEffects`; prompt v2.3 now specifies the exact array schema and passed staging.
- Authority login briefly routed through the organizer workspace; sign-in now resolves the profile before role-based navigation.

Credentials are intentionally excluded. UAT passwords must remain temporary and outside version control.
