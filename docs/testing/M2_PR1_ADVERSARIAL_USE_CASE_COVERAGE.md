# M2 PR1 adversarial use-case coverage

`STERAS_PRD.md` is the sole requirements oracle. The UC-M2 identifiers below are labels for traceability; assertions follow FR-M2-01–FR-M2-14 and the PR1 provisional-assessment boundary.

| Use case | Adversarial behaviour covered | Executable evidence |
|---|---|---|
| UC-M2-01 | Duplicate claims, unavailable AI, missing version, and stale/final publication guards cannot create duplicate or partial current results. | `functions/test/firestore.rules.test.ts` pipeline tests |
| UC-M2-02 | Missing event/current immutable version is rejected; a missing referenced version produces an auditable failed job and no resource output. | `functions/test/firestore.rules.test.ts` UC-M2-02/06 test |
| UC-M2-03 | Unavailable/unmatched/ineligible context is retained as missing evidence and lowers readiness/confidence instead of being treated as safe evidence. | `functions/src/engines/ruleBased.test.ts`, `functions/src/engines/assessmentValidator.test.ts` |
| UC-M2-04 | Missing, non-finite, or out-of-range coordinates never call OpenWeather; malformed/out-of-horizon responses are rejected; retries are bounded. | `functions/src/utils/weather.test.ts` |
| UC-M2-05 | Non-finite timestamps are rejected and Malaysia-local date boundaries are deterministic. | `functions/src/utils/holidays.test.ts` |
| UC-M2-06 | Missing Firestore event/version references do not publish an assessment/resource result. | `functions/test/firestore.rules.test.ts` UC-M2-02/06 test |
| UC-M2-07 | Ambiguous venue names are not arbitrarily matched; only explicitly verified and assessment-eligible incidents enter history. | `functions/test/firestore.rules.test.ts` UC-M2-07 test |
| UC-M2-08 | Readiness, compliance, and confidence remain separate; provisional, blocked, and insufficient-data paths require review. | `functions/src/engines/ruleBased.test.ts` |
| UC-M2-09 | Hard rules only raise scores, exact weighted arithmetic is deterministic, thresholds are covered, and a single High category cannot be averaged away. | `functions/src/engines/assessmentValidator.test.ts`, `functions/src/engines/hardRuleEvaluator.test.ts`, `functions/src/engines/ruleBased.test.ts` |
| UC-M2-10 | Malformed JSON, missing/duplicate/unknown categories, fractional/out-of-range scores, unsupported fields/evidence, low confidence, and missing information are rejected or warned as required. | `functions/src/engines/aiPredictor.test.ts`, `functions/src/engines/assessmentValidator.test.ts` |
| UC-M2-11 | Negative, non-finite, and extremely large finite attendance cannot produce negative, unsafe, reversed, or infinite resource quantities/ranges. | `functions/src/engines/resourceCalculator.test.ts` |
| UC-M2-12 | MiniMax receives only allowlisted de-identified fields; cache/version behaviour is deterministic; rejected output never becomes a proposal. | `functions/src/engines/aiPredictor.test.ts` |
| UC-M2-13 | Unavailable, timeout, and invalid AI attempts are retryable but contain no fabricated categories; manual retry is restricted to assigned authorities and retryable states. | `functions/src/engines/aiPredictor.test.ts`, `functions/src/http/manualRecompute.test.ts`, `functions/test/firestore.rules.test.ts` |
| UC-M2-14 | Claim ownership/current-version checks prevent stale publication; records are server-only; backup codec preserves Firestore values; safe summaries contain no internal proposal/warning/reason fields. | `functions/test/firestore.rules.test.ts`, `functions/src/scripts/firestoreBackupCodec.test.ts` |
| UC-M2-15 | Only assigned authorities/admins can read full assessments; malformed, legacy, stale, or internally inconsistent V3 records fail runtime guards. | `functions/test/firestore.rules.test.ts`, `frontend/src/pages/authority/m2PortfolioData.test.ts` |
| UC-M2-16 | Only assigned authorities/admins can read full resources; missing stage, malformed quantities, and stale resource contracts are rejected. | `functions/test/firestore.rules.test.ts`, `frontend/src/pages/authority/m2PortfolioData.test.ts`, `frontend/src/components/m2/M2Presentation.test.tsx` |
| UC-M2-17 | Full AI proposal/provenance is restricted to assigned authorities/admins; rejected or unavailable AI has no accepted score payload. | `functions/test/firestore.rules.test.ts`, `functions/src/engines/aiPredictor.test.ts`, `frontend/src/components/m2/M2Presentation.test.tsx` |
| UC-M2-18 | Organizers cannot read raw assessment/resource records and receive only a server-written safe projection; injected prompts, warnings, rationales, and hard-rule details are not rendered. | `functions/test/firestore.rules.test.ts`, `frontend/src/components/m2/OrganizerAssessmentSummaryView.test.tsx` |

Authority confirmation/override and official recalculation are deliberately negative-gated in PR1. They become positive-path test targets in the later Authority finalisation PR; PR1 tests require provisional data to remain insufficient for final approval.
