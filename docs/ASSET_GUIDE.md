# STERAS Asset Guide

## Source of Truth

The user-provided [`logo.png`](../logo.png) is the approved brand reference. Production files recreate its shield, guiding star, Malaysian skyline, olive wordmark, and gold accents. Do not substitute the previous simplified landscape mark or generate a new logo concept.

## Brand Assets

| Asset | Use |
|---|---|
| `frontend/src/assets/brand/steras-mark.svg` | Navigation, compact headers, inline brand mark |
| `frontend/src/assets/brand/steras-logo-horizontal.svg` | Light backgrounds, documents, wide headers |
| `frontend/src/assets/brand/steras-logo-horizontal-inverse.svg` | Dark olive or photographic backgrounds |
| `frontend/src/assets/brand/steras-app-icon.svg` | Editable app-icon master |
| `frontend/src/assets/brand/png/steras-mark-1024.png` | High-resolution raster mark |
| `frontend/src/assets/brand/png/steras-logo-horizontal.png` | Raster light-background logo |
| `frontend/src/assets/brand/png/steras-logo-horizontal-inverse.png` | Raster inverse logo |

Keep clear space around the logo equal to the gold star's width. Do not recolor individual landmarks, stretch the shield, add shadows, place the light logo on busy photography, or use the full source board as an interface logo.

## Web and App Assets

| Asset | Use |
|---|---|
| `frontend/public/favicon.svg` | Browser favicon |
| `frontend/public/apple-touch-icon.png` | iOS home-screen icon, 180px |
| `frontend/public/icon-192.png` | PWA icon, 192px |
| `frontend/public/icon-512.png` | PWA icon, 512px |
| `frontend/public/og-image.webp` | Social sharing card, 1200x630 |
| `frontend/public/site.webmanifest` | PWA metadata and icon registration |

## System Imagery

| Asset | Use | Crop guidance |
|---|---|---|
| `public-event-hero.webp` | Public homepage hero | Keep performers center-right and copy over the calmer left side |
| `auth-event-planning.webp` | Login and registration shell | Preserve planning team and venue setup; use `object-cover` |
| `system-empty-state.webp` | Empty, no-match, not-found, and unavailable states | Show at 144-192px; never stretch full width |

System imagery lives in `frontend/src/assets/imagery/`. Generated source PNGs are retained in Codex's generated-image workspace; production uses optimized WebP files to control bundle size.

## Accessibility

- Brand marks next to visible `STERAS` text use empty alt text to avoid repetition.
- Standalone logos use `alt="STERAS"`.
- Informative photography describes the event or planning scene.
- Empty-state illustration is decorative and uses empty alt text.
- Never place essential status or risk information inside an image.

## Visual Reference

See [`STERAS_DESIGN_GUIDELINES.md`](./STERAS_DESIGN_GUIDELINES.md) and [`steras-design-language.png`](./steras-design-language.png) for the complete color, typography, component, and imagery language.
