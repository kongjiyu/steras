# M1 Event Application Templates

This directory contains the editable Word templates supplied for the Module 1 organiser application flow. Every application uses the Core template plus exactly one category-and-venue-specific template.

`STERAS_PRD.md` remains the sole product requirements source. These files are versioned implementation assets and reference material; wording inside a template does not override the PRD.

## Template matrix

| Event category | Indoor | Outdoor fixed-site | Outdoor route-based |
|---|---|---|---|
| Entertainment and Performance Event | `STERAS-T01-ENT-IN-v2.0` | `STERAS-T02-ENT-OF-v1.0` | `STERAS-T03-ENT-OR-v1.0` |
| Sports and Recreational Event | `STERAS-T04-SPT-IN-v1.0` | `STERAS-T05-SPT-OF-v1.0` | `STERAS-T06-SPT-OR-v1.0` |
| Cultural, Heritage and Festival Event | `STERAS-T07-CUL-IN-v1.0` | `STERAS-T08-CUL-OF-v1.0` | `STERAS-T09-CUL-OR-v1.0` |
| Exhibition, Convention and Promotional Event | `STERAS-T10-EXP-IN-v1.0` | `STERAS-T11-EXP-OF-v1.0` | `STERAS-T12-EXP-OR-v1.0` |
| Carnival and Public Celebration | `STERAS-T13-CAR-IN-v1.0` | `STERAS-T14-CAR-OF-v1.0` | `STERAS-T15-CAR-OR-v1.0` |

The common template is `core/Core Event Application Template.docx` with template identifier `STERAS-CORE`.

## Intended implementation use

- Preserve the original `.docx` files for organiser download.
- Use the template identifier and Field IDs as stable extraction references.
- Generate separate preview artifacts for the web interface; do not modify the source Word files during preview generation.
- Browser-ready, visually inspected derivatives are versioned in `output/pdf/m1-template-previews/` and emitted by the frontend build without duplicating the DOCX source tree.
- Treat conditional supporting-evidence rows as input to a versioned recommendation/checklist contract after the rules are confirmed in the PRD.
- Verify `SHA256SUMS` whenever replacing a template so changes are explicit and reviewable.

## Validation performed

- 16 unique DOCX files are present: one Core template and all 15 category/venue combinations.
- All files passed ZIP/OOXML integrity checks.
- No comments, tracked changes, custom XML, external relationships, or author-identifying metadata were detected.
- Every page was rendered and visually inspected for clipping, overlap, and table readability.

Known source-layout issue: `cultural-heritage-festival/Cultural, Heritage and Festival Event - Indoor.docx` renders with an additional blank final page in LibreOffice. The original file is retained unchanged so this repository copy remains byte-identical to the supplied source.
