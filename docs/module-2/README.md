# Module 2 — Current Documentation Set

This folder is the canonical documentation bundle for **M2 — Smart Risk
Assessment and Safety Resource Recommendation**.

## Source of Truth

The repository-root `STERAS_PRD.md` is the sole product-requirements source of
truth. Module 2 is governed by `FR-M2-01` through `FR-M2-14` in that PRD. The
artifacts in this folder are non-normative design, traceability, and submission
materials; if any wording differs from the PRD, the PRD takes precedence.

## Contents

| Artifact | Canonical file | Supporting/editable files |
|---|---|---|
| Use case descriptions | `M2_USE_CASE_DESCRIPTIONS.docx` | `M2_USE_CASE_DESCRIPTIONS.md` |
| Use case diagram | `M2_USE_CASE_DIAGRAM.png` | `.puml`, `.svg`, and Draw.io import versions |
| Simplified activity diagram | `M2_ACTIVITY_DIAGRAM.pdf` | Editable `.drawio` plus `.puml`, `.png`, and `.svg` versions |
| System architecture reference used for M2 | `STERAS_SYSTEM_ARCHITECTURE.png` | `STERAS_SYSTEM_ARCHITECTURE_PROMPT.md` |

## Naming and Traceability

- Functional requirements use `FR-M2-01` through `FR-M2-14` as defined only in
  the repository-root `STERAS_PRD.md`.
- Use cases use `UC-M2-01` through `UC-M2-18`.
- The use case description traceability matrix maps every current requirement
  to its related use cases.
- MiniMax M3 participates in structured hazard identification and proposes
  likelihood/severity inputs under the current confirmed functional
  requirements. The system validates those inputs and applies configured hard
  rules before calculating the official result.
- `UC-M2-01 Assess Submitted Event Application` is the main M2 use case.
- If MiniMax fails, M2 records the failure and creates a review-required
  handoff. An Admin performs the manual review in M3; manual review is not an
  M2 use case.

The original files remain in their previous locations for compatibility. This
folder provides one stable place for review, submission, and future updates.
