# STERAS Production M1–M5 E2E Results

- **Environment:** Firebase project `linkos-496505`
- **Application:** `iTpN6WjUEKtgQFWEliE1` / v1
- **Scenario:** Malaysia Tourism Storytelling Showcase 2026

## Verified checkpoints

| Module | Production checkpoint | Result |
|---|---|---|
| M1 | Combined application extracted and organiser-confirmed | PASS — 12 fields, 100% extraction completion |
| M1 | Evidence and venue integrity | PASS — 18/18 evidence requirements; active canonical KLCC binding |
| M2 | Context acquisition | PASS — OpenWeather available and fresh |
| M2 | AI proposal | PASS — MiniMax-M3, eight unique categories, cache miss |
| M2 | Provisional assessment/resource | PASS — complete/pass, 28 Medium, seven resources |
| M2 | Authority officialisation | PASS — four active review heads; official assessment and official resource |
| M3 | Initial review and assignments | PASS — PDRM, BOMBA, KKM, DBKL |
| M3 | Officer recommendations and second review | PASS — four Approved recommendations; Admin final Approved |
| M3 | Event controls | PASS — MiniMax proposal; four controls published |
| M3 | Control evidence | PASS — 13/13 Stage 1 verified; four Stage 2 items sanitized and published |
| M4 | Incident assessment and response | PASS — MiniMax high/immediate; assigned, responded, resolved `confirmed_true` |
| M4 | M3 control outcome bridge | PASS — incorrect public projection removed; DBKL control `resubmit_required` |
| M5 | Analytics read model | PASS — one eligible event, one verified High incident, complete source coverage |

## Issue found and fixed during E2E

New Draft documents did not persist their Firestore document ID in `EventRecord.eventId`. Provisional M2 used the trigger parameter and succeeded, but official resource finalisation correctly rejected the missing identity as `missing_input`.

The fix now:

1. generates the Firestore document reference before creating a Draft;
2. persists `eventId` and requires it to equal the document path in Firestore rules;
3. rejects missing or spoofed identities;
4. self-heals older Drafts at the trusted submit boundary;
5. keeps official finalisation atomic and retries the same append-only review state.

The affected demonstration event was repaired with its own exact document ID. The idempotent finalisation retry then produced the official resource without modifying review history.

The adversarial event-window check also found that the M3 public discrepancy endpoint could create a report before an event began, while the M4 bridge correctly refused to create an out-of-window incident. That mismatch could leave an orphaned report lock. M3 and M4 now share the same reportable-event guard. A production call before the start time was rejected with `failed-precondition` and created no ticket; the in-window call was used for the final flow.

## Data hygiene

- A managed Firestore recovery export was completed before cleanup.
- 42 obsolete fixture events, 343 Firestore roots, 63 test Auth users, and 32 Storage objects were removed in the first cleanup pass.
- Two remaining obsolete showcase/draft events and their three Storage objects were subsequently removed after the new end-to-end scenario was approved.
- Deleted Storage objects were copied to the restricted backup prefix and verified before deletion.
- The final analytics portfolio contains one current, non-synthetic demonstration application with complete source coverage.

## AI and external service evidence

- M2 risk proposal: `MiniMax-M3`, prompt `v5.0.0-prd-numeric-proposal`.
- M3 control-list proposal: `MiniMax-M3`, prompt `v1.0.0-m3-control-list`.
- Weather provider: OpenWeather, available/fresh measurement snapshot.
- Deterministic resource validation scope: official risk input only; resource ratios remain internal prototype/unverified.

## Final gate

- `npm run typecheck` — PASS
- `npm run lint` — PASS
- Frontend tests — PASS, 34 files / 142 tests
- Functions tests — PASS, 46 files / 306 tests
- Firestore and Storage rules — PASS, 2 files / 90 tests
- `npm run build` — PASS

The post-incident production portfolio returned schema `2026-09-03-m5-v3`, one exact matched record, zero synthetic exclusions, no unavailable sections, and complete coverage for event scan, child collections, current version, assignments, decisions, resources, incidents, controls, and Stage 1 documents.
