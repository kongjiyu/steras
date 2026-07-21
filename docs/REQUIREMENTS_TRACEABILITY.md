# MVP Requirements Traceability

**Source:** `steras-prd.md` v2.1 section 11  
**Status date:** 14 July 2026

| Acceptance Criterion | Planned Verification | Current Status |
|---|---|---|
| Organizer registration, submission, and real-time status | Browser UAT + Auth/Firestore emulators | Passed browser-driven staging submission and live assessment rendering without refresh |
| Invalid fields rejected clearly | Browser UAT + server validation tests | Empty browser submission is blocked at the first required field; invalid server inputs are automated |
| One active assessment per version | Functions emulator duplicate-trigger test | Automated with transactional claim/lease and deterministic audit IDs |
| Deterministic baseline | `ruleBased.test.ts` | Automated |
| Final score bounded to baseline plus 15 | `ruleBased.test.ts` via `finalScoreFor` | Automated |
| AI failure returns baseline within 15 seconds | Unit tests + read-only staging fallback UAT | Passed in 0ms without reading the production secret; adjustment 0 preserved baseline 11 |
| Successful assessment within 60 seconds | Staging timing test | Passed deployed staging golden path on 14 July 2026 |
| Authority provenance and rationale decision | Playwright + Functions emulator | Automated and verified in deployed authority review UI |
| Concurrent decisions cannot conflict | Firestore transaction integration test | Automated for concurrent approval and rejection precedence |
| All required authorities approve same version | Decision aggregation unit/emulator tests | Automated; publication requires unanimous current-version approval |
| Resubmission preserves history and invalidates approvals | Emulator + staging scenario | Passed v1/v2 staging resubmission; v1 remained immutable and five decisions were preserved |
| Assessments, overrides, and decisions are audited | Functions emulator tests | Automated for assessment, resource recommendation/override, and decisions |
| Public and unassigned authorities cannot read private records | Firestore/Storage rule tests | Automated for profiles, events, assessments, evidence, and public paths |
| At least three PII-safe analytics charts | React test + seeded Playwright check | Passed deployed staging with three production-data charts and sanitized CSV export |
| Chrome, Edge, Safari, desktop, and 390px | Browser CLI + manual browser checks | Chromium and WebKit desktop/390px pass; actual Edge is unavailable and Safari automation awaits macOS Accessibility permission |

## Quality Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:rules
npm run build
```

Update this table in the same pull request whenever an acceptance test is added or a criterion changes.
