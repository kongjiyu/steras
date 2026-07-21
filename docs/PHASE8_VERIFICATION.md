# Phase 8 Verification

**Date:** 14 July 2026  
**Environment:** Firebase staging project `linkos-496505`

## Dataset

- Seeded 25 stable Malaysian venues across major states and federal territories.
- Generated deterministic incident records with stable IDs, event types, severities, and 2024-2025 dates.
- Re-running `npm run seed:staging` updates the same records instead of creating random duplicates.

## Deployed Scenario Matrix

| Scenario | Expected result | Result |
|---|---|---|
| Unanimous approval | One v1 assessment and public record | Pass |
| Rejection precedence | Rejected and not public | Pass |
| Amendment/resubmission | Immutable v1, current v2, new approvals | Pass |
| Pending withdrawal | Withdrawn and not public | Pass |

The amendment scenario preserved both immutable versions and five decision-history records. Its sanitized public record points to v2. All successful M3 assessments stayed within the validated `baseline..min(baseline + 15, 100)` range.

## Browser Evidence

- Empty organizer submission is blocked at the first required field by native form validation.
- A valid browser-driven organizer application submitted successfully and rendered its live assessment without a manual refresh (`AZGDyqeVmv3hv3VwjIg7`).
- Public approved-event detail renders only sanitized event information.
- Rejected-event public URL renders the not-public state.
- Assigned PDRM review renders v2 evidence, two-version history, five decision records, and closed approval state.
- Chromium desktop and `390 x 844` checks complete with zero console errors or warnings.
- WebKit desktop, keyboard sequence, and `390 x 844` public detail checks pass with zero console errors or warnings.
- Mobile screenshots: `output/playwright/phase8-amendment-mobile.png`, `output/playwright/phase8-organizer-mobile.png`, and `output/playwright/phase8-webkit-public-mobile.png`.

## Forced AI Fallback

- `npm run uat:fallback` read the real staging approval event and its current assessment.
- The production fallback function was called with no API key; the production MiniMax secret was not read or changed.
- Result returned in 0ms with `unavailable`, adjustment `0`, and final score `11`, preserving baseline `11`.
- The check is read-only and performs no staging writes.

## Remaining Release Gates

- Run the same smoke and keyboard checks in installed Microsoft Edge; Edge is not currently installed on this Mac.
- Complete an actual Safari pass after macOS Accessibility permission is granted; WebKit coverage already passes.
- Rehearse reset/reseed in an isolated project; managed Firestore export is complete.

## Backup Evidence

- Export operation completed successfully for 312 documents (166,445 bytes).
- Backup prefix: `gs://linkos-496505.firebasestorage.app/backups/phase8-20260714`.
- Export metadata and three data shards are present and readable.
- Restore remains intentionally unexecuted against staging to avoid replacing live UAT data; see `docs/BACKUP_RESTORE.md`.
