# General Application and Page Ownership

**Owner:** M2 owner / project integrator

**Scope:** Cross-module integration, global routing, shared UI, public landing experience, and final release coordination

## Ownership Principle

Every route has one page owner. The owner controls the page file, loading/error/empty states, responsive behavior, and final integration. Other modules provide data contracts, functions, or reusable components; they do not directly co-own the page.

General ownership does not mean owning every module feature. It means maintaining the application shell so module work can connect without conflicting edits.

## Current Route Ownership

| Route | Page or behavior | Owner | Status |
|---|---|---|---|
| `/` | `PublicHome.tsx` | General | Implemented |
| `/dashboard-preview` | `DashboardPreview.tsx` | General | Implemented; mock/design-review only; `?view=risk` and `?view=resources` preview M2 pages |
| `*` | `RoleAwareFallback.tsx` | General | Implemented |
| `/login` | `LoginPage.tsx` | M1 | Implemented |
| `/register` | `RegisterPage.tsx` | M1 | Implemented |
| `/calendar` | `PublicCalendar.tsx` | M1 | Implemented |
| `/events/:eventId` | `PublicEventDetail.tsx` | M1 | Implemented |
| `/organizer` | `OrganizerDashboard.tsx` | M1 | Implemented |
| `/organizer/events/new` | `NewEvent.tsx` | M1 | Implemented |
| `/organizer/events/:eventId/edit` | `NewEvent.tsx` | M1 | Implemented |
| `/organizer/events` | `MyEvents.tsx` | M1 | Implemented |
| `/organizer/events/:eventId` | `EventDetail.tsx` | M1 | Implemented; consumes M2/M3 data |
| `/authority/risk` | `RiskAssessments.tsx` official category and evidence portfolio | M2 | Implemented |
| `/authority/resources` | `ResourceRecommendations.tsx` versioned recommendation portfolio | M2 | Implemented |
| `/authority` | `AuthorityDashboard.tsx` | M3 | Implemented |
| `/authority/applications` | `ReviewQueue.tsx` | M3 | Implemented |
| `/authority/events/:eventId` | `AuthorityEventReview.tsx` | M3 | Implemented; consumes M2 data |
| `/authority/audit` | M3 review history; currently redirects | M3 | Planned |
| `/authority/users` | M3 authority administration; currently redirects | M3 | Deferred |
| `/authority/settings` | M3 authority settings; currently redirects | M3 | Deferred |
| `/authority/calendar` | Redirects to M1 public calendar | M1 | Compatibility redirect |
| `/organizer/incidents` | M4 organiser incident list | M4 | Planned |
| `/organizer/incidents/new` | M4 incident report form | M4 | Planned |
| `/organizer/complaints` | M4 organiser complaint list/form | M4 | Planned |
| `/authority/incidents` | M4 authority incident queue | M4 | Planned |
| `/authority/complaints` | M4 complaint investigation queue | M4 | Planned |
| `/authority/reports` | `Analytics.tsx` | M5 | Implemented foundation |

## General-Owned Files

- `frontend/src/App.tsx` and `frontend/src/routing.ts`
- `frontend/src/pages/public/PublicHome.tsx`
- `frontend/src/pages/DashboardPreview.tsx`
- `frontend/src/components/layout/RoleAwareFallback.tsx`
- shared layouts, navigation, status/risk primitives, theme tokens, and global styles
- `frontend/src/config/firebase.ts`
- root documentation index and final integration guidance

Module-specific pages remain owned by their modules even when they use a shared layout.

## Shared UI Rules

- General owns `components/layout/` and truly cross-module `components/ui/` primitives.
- Module-specific components should live under a module folder such as `components/m2/CategoryProfile.tsx`.
- A shared component must not contain a module decision rule. Decision logic stays in its owning module.
- Page owners provide all loading, empty, permission-denied, stale-data, and failure states.
- Route changes must update this file and the relevant module document in the same change.

## Locked Integration Assumptions

- Firebase Authentication is the single identity provider.
- Public signup creates only an organiser profile.
- Authority accounts are provisioned by an administrator and scoped by `authorityType`.
- Firestore subcollections under an event are version scoped.
- The server owns assessments, resources, decisions, audit records, publication, and protected status changes.
- M2 produces the official assessment; M3 produces the human decision.
- Public pages never expose organiser PII, assessment details, incident details, or complaints.
- General may resolve cross-module integration conflicts, but it must not silently change another module's business contract.

## Integration Workflow

1. A module owner updates its module document before changing a shared contract.
2. The owner changes its backend/data contract and tests.
3. The page owner integrates the contract into the owned page.
4. General verifies routing, shared UI consistency, permissions, and full-app quality gates.
5. General coordinates deployment only after all affected module owners confirm the interface.

## Definition of Done

- Every current and planned route appears once in the ownership table.
- No two teammates edit the same page file without an explicit handoff.
- Shared components remain domain-neutral.
- Role redirects and protected routes work for organiser, authority, and signed-out users.
- Navigation remains usable on desktop and mobile.
- `npm run check` and `npm run test:rules` pass before release.
