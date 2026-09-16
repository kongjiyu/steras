# STERAS M3 post-final-approval rehearsal flow

This runbook follows the Module 3 activity diagram from the Admin second-review decision through control publication and the public verification/report path. The four presentation applications are private, authenticated fixtures; they never create a `public_events` projection.

## Prepared applications

| Application | State | What to verify |
| --- | --- | --- |
| `presentation-putrajaya-community-run` | Second Review | Five authority assignments are completed; Admin final decision is still pending. |
| `presentation-penang-heritage-weekend` | Documentation Required | The confirmed control list is visible; no Stage 1 or Stage 2 evidence has been submitted. |
| `presentation-selangor-food-festival` | Documentation Required | Stage 1 documents are uploaded and awaiting authority verification. |
| `presentation-johor-waterfront-fair` | Documentation Required | Stage 1 documents are verified and Stage 2 images await Admin publication. |

## Flow after final approval

1. In Admin, open `presentation-putrajaya-community-run` and confirm that every required authority has a completed current-version assignment. Record the final decision as Approved (or exercise the rejection validation path with a reason, corrective suggestion and category).
2. After approval, open the Event Control List. Generate the proposal, review the five authority controls, and confirm the unchanged proposal. Reopen the page and verify that the persisted proposal draft and revision are restored.
3. As Organizer, open the Event Control List for `presentation-penang-heritage-weekend`. Upload each required Stage 1 document, have the assigned authority verify them, and confirm the control aggregate becomes verified.
4. As Organizer, open `presentation-selangor-food-festival`, then as the assigned authority reject one pending Stage 1 document with a reason and corrective suggestion. Resubmit it as Organizer, verify the corrected document, and confirm the control aggregate returns to verified.
5. As Organizer, upload Stage 2 images for the Penang application only after its required Stage 1 documents are verified. Use a distinct image for each authority control.
6. As Admin, review each Stage 2 image. Publish an acceptable image and reject one image with corrective feedback. Confirm that rejected evidence is not public and that a replacement can be uploaded.
7. For a published Stage 2 item, sign in as a public viewer and use Confirm. Use Report on an inaccurate item and verify that the report creates the M4 incident context without exposing internal Storage paths.
8. Reload each role’s page and verify the state labels, audit entries, notifications, and control evidence remain consistent with the current version.

## Acceptance checks

- Final approval is recorded before any control list is confirmed.
- Stage 2 upload is unavailable until required Stage 1 verification is complete.
- Admin publication is the only operation that creates a public-safe Stage 2 projection.
- The four presentation applications remain absent from `public_events` and `public_event_controls` throughout the rehearsal.
- Closing or reloading the control editor never loses an unconfirmed proposal draft.
