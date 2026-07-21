# Repository Guidelines

## Project Structure & Module Organization

STERAS is a Firebase-backed React app organized as an npm workspace.

- `frontend/`: React 18 + Vite + Tailwind SPA. Main code lives in `frontend/src/`.
- `frontend/src/pages/`: route screens for organizer, authority, auth, and public views.
- `frontend/src/components/`: reusable UI and layout components.
- `frontend/src/config/firebase.ts`: Firebase client setup.
- `functions/`: Firebase Cloud Functions in TypeScript. Source lives in `functions/src/`.
- `functions/src/engines/`: AI prediction, rule-based scoring, and resource calculation logic.
- `functions/src/triggers/` and `functions/src/http/`: Firestore triggers and endpoints.
- `shared/`: cross-workspace TypeScript types.
- `docs/`: project docs; `steras-prd.md` is the PRD source.
- `firestore.rules`, `storage.rules`, `firebase.json`: Firebase configuration.

## Build, Test, and Development Commands

Run from the repository root unless noted.

- `npm install`: install root workspace dependencies.
- `npm run dev`: start the Vite frontend dev server.
- `npm run build`: build both frontend and Firebase Functions.
- `npm run build:frontend`: build only the SPA.
- `npm run build:functions`: compile only Cloud Functions.
- `npm run typecheck`: check TypeScript for frontend and functions.
- `npm run lint`: run frontend ESLint.
- `npm run emulators`: start Firebase Emulator Suite.
- `npm run deploy`: build and deploy Firebase services.

## Coding Style & Naming Conventions

Use TypeScript throughout. Prefer React function components, hooks, and shared types from `shared/types.ts`. Use 2-space indentation, focused modules, and descriptive names.

- Components: `PascalCase.tsx` such as `StatusBadge.tsx`.
- Pages: `PascalCase.tsx` grouped by role.
- Utilities and engines: `camelCase.ts` such as `resourceCalculator.ts`.
- Keep scoring, audit log, and status-transition writes inside Cloud Functions.

## Testing Guidelines

No formal test framework is configured yet. Verify changes with:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Firebase Emulator flows for submission, risk computation, and authority decisions.

When tests are added, place frontend tests near components/pages as `*.test.tsx` and function tests as `*.test.ts`.

## Commit & Pull Request Guidelines

Existing commits use Conventional Commit style, e.g. `chore: initial project base setup for STERAS`. Continue with `feat:`, `fix:`, `docs:`, `chore:`, and `refactor:`.

Pull requests should include a summary, tests run, linked issue or module, and screenshots for UI changes. Note Firebase rule, schema, or environment changes.

## Security & Configuration Tips

Never commit real API keys or service account files. Use `.env.example` as templates. Keep MiniMax, OpenWeather, and Firebase secrets local or in Firebase config. Review Firestore and Storage rules when changing access.
