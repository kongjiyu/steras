# Phase 6 Verification

**Date:** 14 July 2026  
**Environment:** `https://linkos-496505.web.app`  
**Dataset:** Two approved cloud UAT applications assigned to PDRM, BOMBA, and KKM

## Public Experience

- Public calendar read only `public_events` and displayed two approved records.
- Search reduced the result set from two records to the expected single event.
- Event type and month filters are implemented with clear/reset states.
- Public detail exposed only event name, type, schedule, venue, version, and approving authorities.
- Real-time listeners handle publication and removal without refresh.
- Desktop and `390 x 844` layouts showed no horizontal overflow or incoherent overlap.

## Authority Reports

- PDRM Reports loaded two applications through an assigned-authority query.
- Applications/approvals by month, final risk distribution, and baseline-versus-final charts rendered from production data.
- Date range controls, summary metrics, empty/error states, and sanitized CSV export are active.
- CSV tests verify that organizer contacts are absent and spreadsheet formulas are neutralized.
- Browser console check returned zero errors and zero warnings.

## Automated Checks

- Frontend: 10 tests across four files.
- Functions: 58 tests across eight files.
- TypeScript, ESLint, production builds, and `git diff --check` passed.

Advanced venue/type/resource analytics and per-authority turnaround remain scheduled after the MVP reporting core.
