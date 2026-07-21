# STERAS Positive and Negative Test Coverage

Updated: 2026-07-17

This matrix is the regression contract for user-visible modules, callable backend features, assessment engines, and Firebase security boundaries. Every operational feature has at least one successful path and one rejected, unavailable, malformed, or unauthorized path.

| Module / feature | Positive coverage | Negative and error-handling coverage | Layer |
|---|---|---|---|
| Registration | Organizer creation with and without phone; role-home navigation | Duplicate email copy; pending double-submit; Firestore profile failure deletes new Auth user; input preserved | Vitest component/context |
| Login and password reset | Organizer/authority destination; protected deep-link restoration | Invalid credentials; missing profile; network/rate-limit copy; missing reset email | Vitest + browser |
| Protected routing | Correct role renders workspace; query/hash preserved | Guest redirect; cross-role denial; unknown route; missing-profile recovery | Vitest + browser |
| Public calendar | Approved event rendering, search, type/month filtering | Listener failure with retry; empty result; malformed dates excluded | Vitest component/unit |
| Public event detail | Approved sanitized listing | Missing listing distinguished from service failure; retry | Vitest component |
| Organizer drafts | Draft creation/edit and owner-only read/write | Invalid server details; direct Pending creation; generated-field mutation denied | Functions unit + Rules emulator |
| Evidence upload | Supported PDF/JPEG/PNG/WebP in editable version | Wrong version, unsupported/empty/unsafe filename, overwrite, unassigned read, submitted deletion | Storage Rules emulator |
| Event submission/versioning | Valid immutable v1 and amendment v2 | Invalid email/date/capacity/coordinates, wrong owner/role/status/path, duplicate version | Functions unit + Rules emulator |
| My Events | Owned applications and edit/view routes | Listener failure with retry; empty and filtered-empty states | Vitest component |
| Organizer event detail | Current-version assessment/resources and withdrawal | Not found vs load failure; supporting-data failure alert; retry; withdrawal failure toast | UI handling + Rules/Functions |
| Authority dashboard | Summary, risk/status distribution, priority ordering | Empty/unassessed portfolio; data-load failure with retry | Vitest unit + UI handling |
| Review queue | Assigned active records, filtering, sorting, pagination | Listener failure/retry; invalid page size/total; empty search result | Vitest component/unit |
| Authority decision | Approve/reject/amend aggregation and unanimous publication | Missing/invalid decision, rationale bounds, unassigned role, closed version, missing evidence, rejection precedence, idempotency/concurrency | Functions unit + Rules emulator |
| Resource override | Valid bounded quantities with audit record | Negative/fractional/extra/oversized values, rationale bounds, unassigned authority, inactive review, missing recommendation | Functions unit + Rules emulator |
| Analytics and CSV | Monthly grouping, date filters, summary, PII-free export | Invalid/reversed dates, malformed timestamps, zero division, spreadsheet formula injection, query error/retry | Vitest unit + UI handling |
| Deterministic risk engine | Weighted baseline, thresholds, evidence and clamps | Invalid venue capacity, extreme weather/incidents, score/adjustment bounds | Functions unit |
| Resource calculator | Standard and high-risk staffing formulas | Negative, NaN and infinite attendance never produce invalid quantities | Functions unit |
| M3 refinement | Valid response, allowlisted input, caching | Timeout, unavailable API, invalid schema, extra fields, unknown evidence, oversized response, bounded fallback | Functions unit |
| Weather | Forecast selection, alerts, cache and retry | Missing coordinates, stale fallback, transient failure, out-of-horizon forecast | Functions unit |
| Holidays | Malaysia-local holiday/adjacency and UTC boundary | NaN/infinite timestamps rejected with explicit error | Functions unit |
| Manual recompute | Valid normalized event ID and authority execution | Missing/oversized ID, unauthenticated/non-authority, pipeline failure converted to internal error | Functions unit + callable handling |
| Firestore privacy | Owner/assigned authority access and sanitized public reads | Organizer PII denial, role escalation, assessment writes, private public access, cross-version approval reuse | Rules emulator |

## Browser negative smoke cases

- Empty registration submit stays on the page and focuses the first invalid required field.
- Invalid credentials retain the form and show actionable copy without navigating.
- Guest unknown routes return to the public home page.
- Role and deep-link browser flows are covered by the routing regression suite.

## Required release gate

Run these commands before release:

```bash
npm test
npm run test:rules
npm run typecheck
npm run lint
npm run build
```
