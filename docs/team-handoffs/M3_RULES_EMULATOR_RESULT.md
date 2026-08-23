# Module 3 Rules Emulator Result

Date: 2026-08-22

## Environment

- Project-local JDK: Eclipse Temurin 21.0.12.1 LTS
- Firebase emulator project: `steras-test`
- Firestore emulator: `127.0.0.1:18080`
- Storage emulator: `127.0.0.1:19199`
- Real Firebase project: not contacted

## Results

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed — frontend 67, functions 82 |
| `npm run test:rules:local` | Passed — 19 Rules tests |
| `npm run build` | Passed |

The Rules suite covers organizer/admin/authority/public access, named-officer
boundaries, private Stage 2 versus public projections, report/confirmation
markers, Storage upload/read/delete rules, and server-owned generated records.

No Firebase Hosting, Functions, Firestore, or Storage deployment was performed
as part of this local emulator validation.
