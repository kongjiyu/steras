# Module 3 Production Acceptance

**Product:** STERAS

**Firebase target:** `linkos-496505`

**Dataset:** `steras-module3-test-v2`
**PRD baseline:** `STERAS_PRD.md`, FR-M3-01–FR-M3-32

This is the release traceability record. “Automated evidence” identifies the executable coverage; the production column must contain the dated Linkos run result or retained artifact before Module 3 is declared production-ready.

| FR | Required production behavior | Automated evidence | Linkos evidence |
|---|---|---|---|
| FR-M3-01 | Withdrawal closes active reviews/controls, removes public projections and retains audit history. | `withdrawEvent.test.ts`, `firestore.rules.test.ts` | Pending release run |
| FR-M3-02 | Admin initial review starts only after current M2 assessment/resource outputs exist. | `initialReview.test.ts`, `m3-negative-gates.spec.ts` | Pending release run |
| FR-M3-03 | Manual Review Required is available to Admin initial review. | `admin-manual-review.spec.ts`, `manualAssessmentEligibility.test.ts` | Pending release run |
| FR-M3-04 | Admin manual inputs, identity and timestamps become a locked official assessment/resource result. | `manualFinalisation.test.ts`, `admin-manual-review.spec.ts` | Pending release run |
| FR-M3-05 | Initial and second application decisions accept only Approve/Reject. | `initialReview.test.ts`, `makeSecondReviewDecision` unit coverage | Pending release run |
| FR-M3-06 | Admin/officer rejection requires reason and suggestion. | `authorityDecision.test.ts`, `initialReview.test.ts` | Pending release run |
| FR-M3-07 | Admin may attach assigned-officer feedback to rejection. | `initialReview.test.ts`, Admin review UI tests | Pending release run |
| FR-M3-08 | Initial approval advances to authority review; second review records the final result. | `officer-assignment.spec.ts`, `m3-aggregate.spec.ts` | Pending release run |
| FR-M3-09 | Rejection sends organizer reason/suggestion notification. | `m3-controls-notifications.spec.ts`, decision unit tests | Pending release run |
| FR-M3-10 | Assignment checklist lists authenticated authority officers. | `officer-assignment.spec.ts` | Pending release run |
| FR-M3-11 | Checklist defaults officers by event venue state. | `officer-assignment.spec.ts` | Pending release run |
| FR-M3-12 | Admin can alter default officer choices. | `officer-assignment.spec.ts`, `unassign-officer.spec.ts` | Pending release run |
| FR-M3-13 | Assign creates version-scoped named-officer assignments. | `officer-assignment.spec.ts` | Pending release run |
| FR-M3-14 | Only named assigned officers can read/review private applications. | `firestore.rules.test.ts`, `m3-negative-gates.spec.ts` | Pending release run |
| FR-M3-15 | Officer reviews submitted evidence/M2 outputs and records score confirmation or reasoned override. | `pdrm-decision.spec.ts`, authority finalisation tests | Pending release run |
| FR-M3-16 | Officer Reject requires reason and suggestion. | `authorityDecision.test.ts`, `m3-aggregate.spec.ts` | Pending release run |
| FR-M3-17 | Officer Approve requires reviewed-material confirmation. | `officer-assignment.spec.ts`, `m3-negative-gates.spec.ts` | Pending release run |
| FR-M3-18 | Second review is available only after every assignment completes. | `officer-assignment.spec.ts`, `m3-aggregate.spec.ts` | Pending release run |
| FR-M3-19 | Approved application/M2 results/rules are sent to MiniMax for a schema-valid control proposal. | `controlListProposer.test.ts`, `generate-control-list.spec.ts` | Pending real MiniMax run |
| FR-M3-20 | Admin can edit the proposed control list with version/audit protection. | `generate-control-list.spec.ts`, control-list unit tests | Pending release run |
| FR-M3-21 | Organizer uploads required control documentation through server-owned writes. | `organizer-stage1-upload.spec.ts`, `stage2-organizer-upload.spec.ts` | Pending release run |
| FR-M3-22 | Admin publishes only sanitized Stage 2 projections. | `stage2-admin-publish.spec.ts`, Storage/Firestore Rules tests | Pending release run |
| FR-M3-23 | Assigned officer verifies Stage 1 documentation. | `control-verification-ui.spec.ts`, `organizer-stage1-upload.spec.ts` | Pending release run |
| FR-M3-24 | Stage 1 rejection records feedback and requires organizer resubmission. | `organizer-stage1-upload.spec.ts` | Pending release run |
| FR-M3-25 | Resource override preserves original/revised values and officer provenance. | `overrideResources.test.ts`, `pdrm-decision.spec.ts` | Pending release run |
| FR-M3-26 | Generated controls expose Stage 1 and Stage 2 requirements together. | `generate-control-list.spec.ts`, control-list contract tests | Pending release run |
| FR-M3-27 | Eligible Stage 1 purchase receipt supports Use Previous. | `organizer-stage1-upload.spec.ts` | Pending release run |
| FR-M3-28 | Registered public viewers can confirm or report published Stage 2 only. | `stage2-public-confirm-report.spec.ts`, Rules tests | Pending release run |
| FR-M3-29 | Confirmation increments the public counter atomically and visibly. | `stage2-public-confirm-report.spec.ts` | Pending release run |
| FR-M3-30 | Inaccurate Stage 2 report creates the M4-owned ticket/context. | `stage2-public-confirm-report.spec.ts`, `reportStage2Doc` tests | Pending real M4 round trip |
| FR-M3-31 | M4 `confirmed_true` changes the control to resubmit required and notifies/audits. | `onM4ReportOutcome.test.ts` plus Linkos integration run | Pending real M4 round trip |
| FR-M3-32 | M4 `dismissed_fake` restores approved/public state and notifies/audits. | `onM4ReportOutcome.test.ts` plus Linkos integration run | Pending real M4 round trip |

## Release evidence to retain

- merge commit and GitHub Actions CI URL;
- Firebase index status and deployed Functions JSON verified by `verify:deployment`;
- migration dry-run/snapshot/verify output;
- seeder dry-run/verify output and exact fixture manifest;
- Playwright HTML report, screenshots and traces for smoke, full and workstream1;
- real MiniMax proposal validation output without prompt/secret contents;
- two real M4 ticket IDs covering `confirmed_true` and `dismissed_fake`;
- Functions error logs for the release window.

The release is blocked while any Linkos evidence cell remains pending for a required FR.
