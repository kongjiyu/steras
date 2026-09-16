# STERAS M3 post-final-approval rehearsal flow

This runbook follows the Module 3 activity diagram from the Admin second-review decision through control publication and the public verification/report path. The four presentation applications are private, authenticated fixtures; they never create a `public_events` projection.

## Prepared applications

| Application | State | What to verify |
| --- | --- | --- |
| `presentation-putrajaya-community-run` | Second Review | Five authority assignments are completed; Admin final decision is still pending. |
| `presentation-penang-heritage-weekend` | Documentation Required | The confirmed control list is visible; no Stage 1 or Stage 2 evidence has been submitted. |
| `presentation-selangor-food-festival` | Documentation Required | Stage 1 documents are uploaded and awaiting authority verification. |
| `presentation-johor-waterfront-fair` | Documentation Required | Stage 1 documents are verified and Stage 2 images await Admin publication. |

All four records use the real-looking event names and Malaysian venue details shown in the application. They are privately managed presentation fixtures (the ownership marker is stored in Firestore metadata and is not rendered in the normal UI), and the seeder and final-decision callable keep them out of `public_events` and `public_event_controls`.

## Roles, routes and expected results

- **Admin**: `/admin/applications` defaults to **All applications**. Search by any exact application ID above, open the result, and use the application detail route `/admin/applications/<application-id>`. Admin records the initial/final decisions, confirms the control proposal, and publishes or rejects Stage 2 evidence from `/admin/applications/<application-id>/stage2-review`.
- **Authority officer**: `/authority/applications` → the assigned application → `/authority/events/<application-id>`. The assigned authority verifies or rejects each Stage 1 document on this page; Admin sees the resulting progress as read-only. An officer's score review is opened with **Review AI scores** before an AI-assisted decision can be recorded.
- **Organizer**: `/organizer/events` → Event Control List `/organizer/events/<application-id>/controls`. The organizer uploads Stage 1 documents first, then Stage 2 images only after the required Stage 1 records are verified.
- **Public viewer**: `/events/<application-id>` is used only after Admin publishes a Stage 2 image. Confirm and Report are exercised against the sanitised public projection; private fixture records remain excluded.

## Flow after final approval

1. As **Admin**, open `presentation-putrajaya-community-run`, verify five completed current-version authority assignments, and record the final decision. Try the rejection path once with a reason, corrective suggestion and category if validating rejection; restore the baseline as **Second Review** before the next run.
2. After an Admin approval, the control-list dialog opens automatically. If it is closed, reopen `/admin/applications/presentation-putrajaya-community-run/controls`; the current-version draft is restored. Review the five authority controls and select **Confirm control list** without editing. Once confirmed, the cards are immutable and read-only.
3. As **Organizer**, open `presentation-penang-heritage-weekend` at the Event Control List route and upload both required Stage 1 documents for each authority control. The assigned **Authority** officer verifies them from the Authority application page (not from the Admin page); Admin only observes the read-only progress summary.
4. For `presentation-selangor-food-festival`, as Organizer upload the pending Stage 1 documents. As the assigned Authority officer reject one document with a reason and corrective suggestion, then resubmit the corrected file as Organizer and verify it again from the Authority application page. The control aggregate returns to verified only after every required document is verified.
5. For `presentation-johor-waterfront-fair`, confirm the baseline already has Stage 1 verified and canonical Stage 2 documents waiting for Admin publication. For Penang, upload Stage 2 images only after Stage 1 verification; use a distinct image for each authority control.
6. As **Admin**, review Stage 2 images at `/admin/applications/<application-id>/stage2-review`. Publish an acceptable image and reject one with corrective feedback. The rejected image remains private and can be replaced by the Organizer; publishing is the only step that creates a public-safe projection.
7. For a published Stage 2 item, sign in as a public viewer at `/events/<application-id>` and use Confirm. Use Report on an inaccurate item and verify the M4 incident context without exposing internal Storage paths.
8. Reload each role's page and verify the derived state labels, audit entries, notifications, current-version proposal/controls, and evidence IDs remain consistent.

## Acceptance checks

- Final approval is recorded before any control list is confirmed.
- Stage 2 upload is unavailable until required Stage 1 verification is complete.
- Admin publication is the only operation that creates a public-safe Stage 2 projection.
- The four presentation applications remain absent from `public_events` and `public_event_controls` throughout the rehearsal.
- Closing or reloading the control editor never loses an unconfirmed proposal draft.

## Guarded baseline restoration

Use the presentation seeder only with the expected production project and the explicit confirmation token. During rehearsal, select one managed record at a time with `--only presentation-<slug>`; never pass an arbitrary event ID. After a flow, run the verifier and then re-apply the documented baseline for that record. The verifier aborts on venue collisions, unowned records, stale pointers, non-canonical Stage 2 IDs, missing control/proposal coverage, inconsistent evidence states, or any public projection. The four baselines are restored as follows:

- `presentation-putrajaya-community-run`: **Second Review**, five completed assignments/reviews, no control list yet.
- `presentation-penang-heritage-weekend`: **Documentation Required**, confirmed controls, no Stage 1 or Stage 2 evidence.
- `presentation-selangor-food-festival`: **Documentation Required**, Stage 1 uploaded and pending Authority verification, no Stage 2 evidence.
- `presentation-johor-waterfront-fair`: **Documentation Required**, Stage 1 verified and canonical `-s2` Stage 2 evidence pending Admin publication.
