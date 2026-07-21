# STERAS — Smart Tourism Event Risk & Approval System

STERAS is a Firebase-backed web application for preparing, assessing, reviewing, and publishing Malaysian tourism events. It gives event organizers and government authorities one auditable workflow instead of disconnected forms, spreadsheets, and agency decisions.

The system is designed around three outcomes:

- organizers submit complete, versioned event applications and supporting evidence;
- authorities review one authoritative risk result, validate recommended safety resources, and record agency decisions;
- the public sees only sanitized events unanimously approved by every required authority.

STERAS is an academic project aligned with the Visit Malaysia 2026 context. It is not an official government permitting service.

Project references:

- [Product requirements](./steras-prd.md)
- [Implementation plan](./docs/IMPLEMENTATION_PLAN.md)
- [Module mapping](./docs/MODULE_MAPPING.md)
- [Design guidelines](./docs/STERAS_DESIGN_GUIDELINES.md)
- [Positive and negative test coverage](./docs/TEST_COVERAGE_MATRIX.md)

## Who uses it?

| Role | What the role can do |
|---|---|
| Public visitor | Browse the sanitized register of approved tourism events. |
| Organizer | Register, create and edit drafts, upload evidence, submit immutable versions, track assessment and decisions, respond to amendment requests, and withdraw eligible applications. |
| Authority reviewer | View applications assigned to the reviewer’s agency, inspect evidence and assessment provenance, adjust recommended resources with a rationale, and approve, reject, or request amendments. |

Authority accounts are provisioned by an administrator. Public registration always creates an organizer account and cannot grant authority privileges.

## End-to-end workflow

```text
Organizer draft
    ↓ upload version-scoped evidence
Submit immutable application version
    ↓
Deterministic five-factor baseline
    + bounded MiniMax M3 adjustment (0–15)
    ↓
Authoritative final risk + recommended resources
    ↓
Assigned authority reviews and decisions
    ├─ Amendment requested → organizer submits a new immutable version
    ├─ Rejected → application remains private
    └─ Every required authority approves
                         ↓
              Sanitized public event listing
```

Application statuses are:

```text
Draft → Pending → Under Review → Approved
                    ├─ Amendment Requested → Pending (new version)
                    └─ Rejected

Draft or Pending → Withdrawn
```

## Modules

### Module 1 — Event management

Organizer-facing application management:

- draft creation and editing;
- event, venue, attendance, environment, emergency plan, and organizer details;
- PDF/JPEG/PNG/WebP evidence uploads, limited to 10 MB per file;
- server-validated submission and immutable `v1`, `v2`, ... versions;
- amendment/resubmission and withdrawal;
- real-time status, assessment, and resource tracking.

Primary implementation:

- `frontend/src/pages/organizer/`
- `functions/src/http/submitEvent.ts`
- `functions/src/http/withdrawEvent.ts`
- `storage.rules`

### Module 2 — Smart risk assessment

Server-side hybrid assessment:

- deterministic weather, crowd, venue, incident-history, and holiday sub-scores;
- rule-version and source-timestamp provenance;
- OpenWeather context with cache and fallback handling;
- Malaysian public-holiday and weekend context;
- MiniMax M3 refinement using a strict non-PII allowlist;
- server validation that limits the M3 upward adjustment to `0–15`;
- deterministic fallback when M3 is unavailable, invalid, or times out.

MiniMax does not produce a competing AI score. The authoritative result is:

```text
final score = deterministic baseline + validated M3 adjustment
```

Primary implementation:

- `functions/src/engines/ruleBased.ts`
- `functions/src/engines/aiPredictor.ts`
- `functions/src/utils/weather.ts`
- `functions/src/utils/holidays.ts`
- `functions/src/triggers/onEventCreated.ts`

### Module 3 — Safety resource recommendation

Produces operational recommendations for:

- police officers;
- security personnel;
- medical teams and ambulances;
- fire officers;
- portable toilets;
- waste bins.

Authorities may override quantities only during active review. Every override requires a rationale and records the previous values, reviewer, agency, version, timestamp, and audit entry.

Primary implementation:

- `functions/src/engines/resourceCalculator.ts`
- `functions/src/http/overrideResources.ts`
- authority review UI in `frontend/src/pages/authority/AuthorityEventReview.tsx`

### Module 4 — Authority review

Agency-specific operational workspace:

- live dashboard and assigned review queue;
- search, status filters, priority sorting, and pagination;
- final risk, deterministic baseline, M3 adjustment, sub-scores, and evidence;
- version history and decision history;
- transactional Approve, Reject, and Amendment Requested decisions;
- concurrent multi-agency decision aggregation;
- public publication only after unanimous approval of the same version.

Supported authority types are `PDRM`, `BOMBA`, `KKM`, `DBKL`, and `MOTAC`.

Primary implementation:

- `frontend/src/pages/authority/`
- `functions/src/http/authorityDecision.ts`
- `functions/src/http/manualRecompute.ts`

### Module 5 — Analytics and public views

- authority portfolio summaries and monthly charts;
- application, approval, final-risk, and baseline-versus-final analysis;
- local date-range filters;
- PII-free CSV export with spreadsheet-formula neutralization;
- searchable and filterable public approved-event calendar;
- sanitized public event detail pages.

Primary implementation:

- `frontend/src/pages/authority/Analytics.tsx`
- `frontend/src/pages/authority/analyticsData.ts`
- `frontend/src/pages/public/`

## Main routes

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Project landing page |
| `/calendar` | Public | Approved-event register |
| `/events/:eventId` | Public | Sanitized approved-event detail |
| `/register` | Public | Organizer registration |
| `/login` | Public | Organizer or authority sign-in |
| `/dashboard-preview` | Public mock preview | Design-review preview using mock data; it is not a real authority workspace |
| `/organizer` | Organizer | Organizer dashboard |
| `/organizer/events/new` | Organizer | New event application |
| `/organizer/events` | Organizer | Organizer application list |
| `/organizer/events/:eventId` | Organizer | Application result and status |
| `/organizer/events/:eventId/edit` | Organizer | Draft or amendment editing |
| `/authority` | Authority | Authority operations dashboard |
| `/authority/applications` | Authority | Assigned review queue |
| `/authority/events/:eventId` | Authority | Full authority review tool |
| `/authority/reports` | Authority | Analytics and CSV export |

Protected routes preserve the requested deep link after sign-in. Cross-role access is redirected to the signed-in user’s own workspace.

Legacy authority paths are compatibility redirects: `/authority/risk`, `/authority/resources`, and `/authority/audit` go to the applications queue; `/authority/calendar` goes to the public calendar; `/authority/users` and `/authority/settings` go to the authority dashboard.

## Technology

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, React Router |
| Styling | Tailwind CSS and shared STERAS design tokens |
| Authentication | Firebase Authentication, email/password |
| Database | Cloud Firestore real-time listeners and transactions |
| File evidence | Firebase Cloud Storage |
| Backend | Firebase Cloud Functions v2, Node.js 22 |
| Charts | Chart.js and react-chartjs-2 |
| AI refinement | MiniMax M3 through the Anthropic-compatible API |
| Weather | OpenWeather API |
| Testing | Vitest, Testing Library, Firebase Rules Unit Testing, Playwright smoke testing |

## Repository structure

```text
steras/
├── frontend/
│   ├── src/
│   │   ├── components/       Shared layouts and UI components
│   │   ├── contexts/         Authentication state and error handling
│   │   ├── pages/
│   │   │   ├── auth/         Login and organizer registration
│   │   │   ├── organizer/    Draft, submission, list, and detail screens
│   │   │   ├── authority/    Dashboard, queue, review, and reports
│   │   │   └── public/       Landing page and approved-event register
│   │   ├── config/           Firebase client and emulator connections
│   │   └── routing.ts        Role-home and post-login routing policy
│   ├── tailwind.config.js
│   └── vite.config.ts
├── functions/
│   ├── src/
│   │   ├── engines/          Risk, M3, and resource engines
│   │   ├── http/             Callable submission, withdrawal, review, override, retry
│   │   ├── triggers/         Assessment and resource pipeline
│   │   ├── utils/            Weather, holidays, model verification, audit helpers
│   │   ├── seed/             Authority and Malaysian venue seed scripts
│   │   └── scripts/          Staging UAT and verification tools
│   └── test/                 Firestore and Storage Rules tests
├── shared/types.ts           Contracts shared by frontend and Functions
├── docs/                     Architecture, design, testing, and operations docs
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── storage.cors.json
├── firebase.json
└── package.json              npm workspace commands
```

## Prerequisites

- Node.js 20 or newer. Cloud Functions deploy with Node.js 22.
- npm.
- Firebase CLI authenticated with access to a Firebase project.
- Java for the local Firebase Emulator Suite.
- Google Cloud CLI application-default credentials for admin seed scripts.

Install and authenticate the CLIs if needed:

```bash
npm install -g firebase-tools
firebase login
gcloud auth application-default login
```

## Quick start

### 1. Install dependencies

From the repository root:

```bash
npm install
```

This installs both npm workspaces: `frontend/` and `functions/`.

### 2. Configure the frontend

```bash
cp frontend/.env.example frontend/.env
```

Fill the Firebase Web App values from Firebase Console → Project settings:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_FIREBASE_FUNCTIONS_REGION=asia-southeast1
VITE_USE_FIREBASE_EMULATOR=false
```

Firebase client configuration is public configuration, not a server secret. Access control is enforced by Authentication, Firestore Rules, Storage Rules, and server-side Functions.

### 3. Configure Functions

```bash
cp functions/.env.example functions/.env
cp functions/.secret.local.example functions/.secret.local
```

`functions/.env` contains non-secret model configuration. `functions/.secret.local` is for local Emulator secrets only:

```dotenv
MINIMAX_API_KEY=
OPENWEATHER_API_KEY=
```

Set deployed project secrets through Firebase Secret Manager:

```bash
firebase functions:secrets:set MINIMAX_API_KEY
firebase functions:secrets:set OPENWEATHER_API_KEY
```

### 4. Run the frontend

To use the Firebase project configured in `frontend/.env`:

```bash
npm run dev
```

Open <http://localhost:5173>.

The project currently configured in `.firebaserc` is `linkos-496505`. Its deployed development site is <https://linkos-496505.web.app>.

STERAS supports three development modes:

| Mode | How it works |
|---|---|
| Frontend with deployed Firebase | `VITE_USE_FIREBASE_EMULATOR=false`; Vite talks to the Firebase project in `frontend/.env` |
| Full local development | `VITE_USE_FIREBASE_EMULATOR=true`; run the Emulator Suite and Vite in separate terminals |
| Deployed staging verification | Run staging UAT and fallback scripts against the explicitly selected Firebase project |

## Local development with Firebase Emulators

Set this in `frontend/.env`:

```dotenv
VITE_USE_FIREBASE_EMULATOR=true
```

Start the Emulator Suite:

```bash
npm run emulators
```

The configured local ports are:

| Service | Port |
|---|---:|
| Emulator UI | 4000 |
| Hosting | 5000 |
| Functions | 5001 |
| Firestore | 8080 |
| Authentication | 9099 |
| Storage | 9199 |

In a second terminal, start Vite:

```bash
npm run dev
```

The frontend connects to Auth, Firestore, Functions, and Storage emulators when `VITE_USE_FIREBASE_EMULATOR=true`.

## Create users and seed data

### Organizer

Open `/register` and create an account. The registration form creates an Authentication user and the matching `users/{uid}` organizer profile.

If profile creation fails, STERAS removes the newly created Authentication user so the email is not left occupied by an unusable account.

### Authority

Authority roles must be provisioned with the admin seed script:

```bash
AUTHORITY_EMAIL=reviewer@example.com \
AUTHORITY_PASSWORD='use-a-strong-temporary-password' \
AUTHORITY_NAME='PDRM Reviewer' \
AUTHORITY_TYPE=PDRM \
npm --workspace functions run seed:authority
```

Valid `AUTHORITY_TYPE` values are `PDRM`, `BOMBA`, `KKM`, `DBKL`, and `MOTAC`.

The script uses `FIREBASE_PROJECT_ID`, then `GCLOUD_PROJECT`, and otherwise defaults to `linkos-496505`. Set the project explicitly when you do not intend to write to the default project.

To provision against local emulators, run the command from a shell with:

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
GCLOUD_PROJECT=steras-test \
AUTHORITY_EMAIL=reviewer@steras.test \
AUTHORITY_PASSWORD='local-demo-password' \
AUTHORITY_NAME='Local PDRM Reviewer' \
AUTHORITY_TYPE=PDRM \
npm --workspace functions run seed:authority
```

### Malaysian venues and incident history

The seed command writes 25 stable Malaysian venues and deterministic incident history using the Admin SDK:

```bash
npm run seed:staging
```

Confirm the active project before running admin scripts. They bypass client security rules.

## How to use the application

### Organizer workflow

1. Register at `/register` or sign in at `/login`.
2. Open **New Event**.
3. Complete event, venue, capacity, attendance, schedule, organizer, and emergency-plan fields.
4. Save a draft.
5. Upload evidence files to the current editable version.
6. Submit the application. Submission validates the data and freezes an immutable version.
7. Open **My Events** to follow assessment and authority decisions.
8. If an amendment is requested, edit the new version and resubmit it.
9. Draft or Pending applications may be withdrawn.

### Authority workflow

1. Sign in with an admin-provisioned authority account.
2. Use the dashboard or **Applications** queue to open assigned work.
3. Inspect the final risk first, followed by baseline provenance, M3 adjustment, sub-scores, documents, and resources.
4. Download and inspect submitted evidence.
5. Optionally adjust resources with a rationale of 10–1,000 characters.
6. Enter a decision rationale and choose **Approve**, **Reject**, or **Request amendment**.
7. Use **Reports** for assigned-agency analytics and PII-free CSV export.

### Public workflow

1. Open `/calendar`.
2. Search by event or venue, filter by type and month, and open an event.
3. Only sanitized events unanimously approved for the same immutable version appear here.

## Available commands

Run commands from the repository root unless stated otherwise.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite frontend |
| `npm run emulators` | Start the configured Firebase Emulator Suite |
| `npm run typecheck` | Type-check frontend and Functions |
| `npm run lint` | Lint frontend and Functions |
| `npm test` | Run frontend and Functions unit/component tests |
| `npm run test:rules` | Run Firestore and Storage Rules tests in emulators |
| `npm run test:coverage` | Generate Vitest coverage reports |
| `npm run build` | Build frontend and Functions |
| `npm run check` | Run typecheck, lint, tests, and build |
| `npm run verify:minimax` | Verify the configured MiniMax model |
| `npm run seed:staging` | Seed stable venues and incidents using Admin credentials |
| `npm run uat:staging` | Run the deployed staging golden-path scenario |
| `npm run uat:fallback` | Verify deployed deterministic fallback behavior |
| `npm run deploy` | Build and deploy all Firebase services |
| `npm run deploy:functions` | Build and deploy Functions only |
| `npm run deploy:hosting` | Build and deploy Hosting only |

## Testing and release checks

The test suite includes positive and negative cases for authentication, routing, public pages, organizer workflows, authority review, analytics, risk/resource engines, Callable Functions, concurrency, and Firebase Rules.

Run the complete local release gate:

```bash
npm run typecheck
npm run lint
npm test
npm run test:rules
npm run build
```

See [docs/TEST_COVERAGE_MATRIX.md](./docs/TEST_COVERAGE_MATRIX.md) for the per-feature positive/negative contract.

`npm run check` does not start Firebase emulators and therefore does not include `npm run test:rules`; run both commands for the full release gate.

The staging golden-path command creates isolated UAT accounts and data, submits an event, waits for assessment, validates a resource override, records the required approvals, and confirms sanitized public publication:

```bash
UAT_PASSWORD='use-a-strong-temporary-password' npm run uat:staging
```

Do not use production user credentials with UAT scripts.

## Build and deploy

Select the intended Firebase project first:

```bash
firebase use --add
```

Then deploy:

```bash
npm run deploy
```

Apply the Storage CORS policy after creating or replacing the bucket:

```bash
gcloud storage buckets update gs://YOUR_BUCKET_NAME --cors-file=storage.cors.json
```

Hosting rewrites all paths to `frontend/dist/index.html`, allowing React Router deep links to work after refresh.

## Security model

- public users read only `public_events`, never organizer applications;
- organizers can access their own applications and editable evidence;
- assigned authorities can access only applications requiring their agency;
- assessment, resource, decision, audit, submission, and publication writes are server controlled;
- evidence paths are version scoped and cannot be overwritten in place;
- submitted evidence cannot be changed or deleted;
- public analytics and CSV exports exclude organizer PII;
- M3 receives only an approved non-PII input allowlist;
- secrets belong in Secret Manager or `.secret.local`, never committed files.

## Troubleshooting

### `auth/email-already-in-use`, but no Firestore user exists

The email may exist in Firebase Authentication without a `users/{uid}` profile, usually from an older interrupted registration. Remove or repair that Authentication user through an administrator. Current registration code compensates by deleting a newly created Auth user if profile creation fails.

### `Firebase is not configured`

Copy `frontend/.env.example` to `frontend/.env`, fill the required `VITE_FIREBASE_*` values, and restart Vite.

### Emulator data does not appear

Check that `VITE_USE_FIREBASE_EMULATOR=true`, restart Vite after changing the environment file, and confirm Emulator UI at <http://localhost:4000>.

### Assessment stays in processing or falls back

Check Functions logs and local/deployed `MINIMAX_API_KEY` and `OPENWEATHER_API_KEY`. STERAS intentionally falls back to the deterministic baseline when M3 is unavailable; this is not a separate AI score.

### Seed script authentication fails

Run `gcloud auth application-default login`, confirm the target Firebase project, and ensure the account has the required Admin SDK permissions.

## Scope constraints

STERAS does not include image-based crowd detection, IoT hardware, a custom-trained machine-learning model, or live surveillance streams. MiniMax is used only as a bounded evidence-based refinement of the deterministic risk baseline.

## License

UNLICENSED — academic project for university coursework.
