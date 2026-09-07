# UI feedback implementation review

Original Google Doc: https://docs.google.com/document/d/12jvwEfBeLYHmNxULfaU1zZf1JqEC3i1O07kj20S65Nc/edit?tab=t.y6bemz3llj3m
Solutions tab: https://docs.google.com/document/d/12jvwEfBeLYHmNxULfaU1zZf1JqEC3i1O07kj20S65Nc/edit?tab=t.ln1cedtr7btz

68 issue IDs, UI-001 through UI-068. The original UI feedback is retained; 66 reply paragraphs cover the 68 IDs. The solutions table records implementation, explanation, verification and review status. Actual browser screenshots are embedded.

## Validation

- `npm run check`: typecheck, lint, frontend/Functions build, 192 frontend tests and 334 Functions tests passed.
- Full Firestore/Storage emulator suite: 95 tests passed.
- After the withdrawal FieldValue runtime fix: Functions build, 4 real Firestore transaction tests, and browser withdrawal passed.
- Registration tests after the final sign-out confirmation: 5 passed.
- Final typecheck and `git diff --check` passed.
- Browser evidence: local/emulator organizer preparation, JPG preview, profile and onboarding; admin layout/control state; public confirm/undo/report/withdraw. The 390 px admin and organizer layouts do not overflow the viewport. Screenshots under `output/playwright/ui-feedback-*.png`.

## Scope and remaining review

Scoped UI changes were released from an isolated checkout based on the latest origin/main, preserving unrelated edits in the original workspace. GitHub push and Firebase deployment completed successfully.

MOTAC demo Auth/user/officer records were repaired in live Firebase and login was verified. Credentials are in the local private file `output/ui-feedback/motac-demo-credentials.txt`; never commit that file. Existing live reports: 2; missing M4 incident records: 0.

UI-001 and UI-043: original local loader alternatives need visual review; exact Uiverse sources were inaccessible. UI-015: English T&C wording needs project-owner review. UI-020: Firebase reset implementation is tested, but real mailbox delivery remains for the user demo.

Final readback: 68 unique IDs, 66 source reply paragraphs, 22 inserted screenshots, and no table-content mismatches. Original source text remained present. PDF export returned 403 Forbidden, so rendered PDF pagination was not verified.

The emulator interrupted the final upload retest. Its Firestore fixtures were exported and restored into the full emulator suite. The repeated browser flow then passed: upload two files, assign one, save draft, refresh; all four files (including the two existing entries) remained selectable.

## Isolated release validation

The release excludes unrelated local M2 and resilience work. `VITE_USE_FIREBASE_EMULATOR=false npm run check` passed with 178 frontend tests, 334 Functions tests, typecheck, lint and both builds. The earlier 192 frontend test count describes the original combined working directory.

## Published release — 7 September 2026

- Application commit: `516b3fc4b3c64e37e0dc2d607e1364a21686a408`, pushed to `https://github.com/kongjiyu/steras` main.
- Production: `https://linkos-496505.web.app`, Firebase project `linkos-496505`.
- Hosting and Firestore Rules deployed successfully. Nine targeted Functions are ACTIVE in asia-southeast1: updateOwnProfile, withdrawStage2Report, confirmStage2Doc, reportStage2Doc, makeInitialReviewDecision, makeAuthorityDecision, submitEvent, listIncidents, onPublicReportCreated. No unrelated Functions were deployed or deleted.
- Isolated release validation: 178 frontend tests, 334 Functions tests, 95 Firestore/Storage tests, typecheck, lint and both builds passed.
- Live Hosting HTML exactly matches the release build: SHA-256 `c26d98c333c51879122693ee28b205229e2b74f6edc7bdf2d6cdb41a384da477`.
- Live browser smoke: registration consent/password requirements, Terms & Conditions and reset page render; 390 px reset viewport has document width 390 px. No registration or reset email was submitted.
- Both new callable endpoints reject anonymous requests with 401 UNAUTHENTICATED. Full write-flow acceptance remains evidenced by emulator tests, not a claim of production UAT.
- Google Docs release introduction and all 66 original reply paragraphs updated with the deployed code commit. The 22 embedded screenshots retain their local/emulator labels.
