# STERAS — Smart Tourism Event Risk & Approval System

> **A B2B/B2G web app that helps Malaysian authorities (PDRM, Bomba, KKM, DBKL) approve tourism event permits faster using AI prediction + rule-based risk scoring + auto-recommended resources.**

Built for **Visit Malaysia 2026** target of 35.6M tourist arrivals. Replaces inconsistent manual risk assessment with a hybrid AI + deterministic rule engine.

> 📄 Full spec: see [`steras-prd.md`](./steras-prd.md) · 📋 Module-by-module breakdown: [`docs/MODULE_MAPPING.md`](./docs/MODULE_MAPPING.md)

---

## Quick Start (10 min)

### 1. Install dependencies

```bash
# from repo root
npm install
```

This installs for both `frontend/` and `functions/` workspaces (npm workspaces).

### 2. Configure environment

```bash
# Frontend (public Firebase config — Vite only exposes VITE_* vars)
cp frontend/.env.example frontend/.env
# Fill in your Firebase web app config from Firebase Console → Project Settings

# Functions (server-side secrets)
cp functions/.env.example functions/.env
# Fill in MiniMax M3 API key + OpenWeather API key
# For local emulators, see "Local emulators" below.
```

### 3. Run the dev server

```bash
npm run dev
```

Open http://localhost:5173

You'll see the public homepage. To access the organizer / authority flows:

- **Register an organizer** at `/register` → submit events at `/organizer/events/new`
- **Register an authority** at `/register` (select "Authority Reviewer") → review at `/authority/queue`

> ⚠️ Cloud Functions (Module 2 + 3 risk scoring) only run if you've configured Firebase + deployed functions. For local-only frontend dev, see the emulator section below.

---

## Project Structure

```
steras/
├── frontend/                  React 18 + Vite + Tailwind + Firebase SDK
│   ├── src/
│   │   ├── pages/             role-based: public/ organizer/ authority/ auth/
│   │   ├── components/        layout (AppLayout, ProtectedRoute) + ui (Badge, StatusBadge, RiskBadge)
│   │   ├── contexts/          AuthContext (Firebase Auth)
│   │   ├── services/          (TODO: Firestore service wrappers)
│   │   ├── config/            Firebase init + emulator wiring
│   │   ├── types/             re-exports from @shared
│   │   └── utils/             (TODO: helpers)
│   ├── tailwind.config.js     STERAS brand colors
│   ├── vite.config.ts         workspace aliasing (@shared)
│   └── .env.example
│
├── functions/                 Firebase Cloud Functions (Node.js 22)
│   ├── src/
│   │   ├── engines/           ruleBased.ts · aiPredictor.ts · resourceCalculator.ts
│   │   ├── triggers/          onEventCreated.ts · onDecisionMade.ts
│   │   ├── utils/             weather.ts · holidays.ts · audit.ts
│   │   ├── http/              manualRecompute.ts (callable)
│   │   ├── seed/              seedVenues.ts (synthetic dataset)
│   │   └── index.ts           firebase-admin init + exports
│   └── .env.example
│
├── shared/                    Types/enums shared between frontend + functions
│   └── types.ts               UserProfile, EventRecord, RiskScoreRecord, ...
│
├── docs/
│   └── MODULE_MAPPING.md      Per-module build status, owners, TODOs
│
├── firestore.rules            Role-based access (organizer/authority/public)
├── firestore.indexes.json     Composite indexes for queries
├── storage.rules              Event documents (permits, insurance) rules
├── firebase.json              Emulators + deploy config
├── .firebaserc                Project alias
└── package.json               Root npm workspaces
```

---

## Tech Stack (per PRD §10)

| Layer | Tech | Why |
|-------|------|-----|
| **Frontend** | React 18 + Vite + TypeScript | Fast dev, type-safe, easy deploy to Firebase Hosting |
| **Styling** | Tailwind CSS | Rapid iteration on UI without naming overhead |
| **State** | react-firebase-hooks | Real-time Firestore listeners without Redux |
| **Charts** | Chart.js + react-chartjs-2 | Lightweight, no canvas boilerplate |
| **Auth** | Firebase Authentication | Email/password, role-based via Firestore rules |
| **Backend** | Firebase Cloud Functions (Node 22) | Server-side risk + resource engines |
| **DB** | Firestore (NoSQL, real-time) | Live dashboard, no polling |
| **Storage** | Cloud Storage | Uploaded permits/insurance docs |
| **AI** | MiniMax M3 (Anthropic-compatible) | Contextual risk reasoning with natural-language explanation |
| **Weather** | OpenWeather API | Real-time forecast for risk engine |
| **Dev** | Firebase Emulator Suite | Local testing of Functions + Firestore + Auth |

---

## Local Development with Emulators

```bash
# 1. Set the project alias
firebase use --add   # pick your steras-dev project

# 2. Enable emulators in frontend/.env
echo "VITE_USE_FIREBASE_EMULATOR=true" >> frontend/.env

# 3. Start emulators (Firestore + Functions + Auth + Hosting)
npm run emulators

# 4. In another terminal, start the dev server
npm run dev
```

The emulators will pick up the seed data via:

```bash
cd functions
npm run build
node lib/seed/seedVenues.js   # seeds 10 venues + synthetic incidents
```

---

## Build & Deploy

```bash
# Build everything
npm run build

# Deploy everything
npm run deploy

# Or deploy selectively
npm run deploy:functions
npm run deploy:hosting
```

---

## Team Workflow

5 module owners (per PRD §9):

| Module | Lead | Support |
|--------|------|---------|
| 1. Event Management | Requirement Lead | Project Manager |
| 2. Smart Risk Assessment | Programmer | Design Lead |
| 3. Safety Resource Recommendation | Design Lead | Programmer |
| 4. Authority Dashboard | Programmer | Design Lead, Tester |
| 5. Analytics & Reporting | Tester | Programmer |

Each module has clear file boundaries — see [`docs/MODULE_MAPPING.md`](./docs/MODULE_MAPPING.md) for "where to put what" and current build status.

**Build order (per PRD §8):** Module 1 → 2 → 3 → 4 → 5.

---

## Hybrid AI + Rules Architecture (key design decision)

Per PRD §3:

1. **AI Predictor (MiniMax M3)** — contextual reasoning + natural language explanation
2. **Rule-Based Engine** — deterministic scoring per WHO/PDRM/Bomba standards
3. **Disagreement Detector** — if |AI − Rule| ≥ 15 → flag for manual review (threshold in `shared/types.ts → DISAGREEMENT_THRESHOLD`)

Why this matters:
- **Audit trail** — rule-based outputs are deterministic and explainable
- **AI hallucination mitigation** — per academic reviews of LLM in safety-critical domains
- **Graceful degrade** — if AI fails, rule-based still produces an answer

---

## Cost & Quota Considerations

- **MiniMax M3**: cap at 1000 calls/day; cache identical requests in Cloud Function
- **OpenWeather**: free tier 1000 calls/day; 30-min in-memory cache in Cloud Function
- **Firebase**: monitor usage; set budget alerts at 50% / 80% of planned quota

---

## Hard Constraints (per PRD §11)

- ❌ No image processing / crowd detection
- ❌ No ML model trained on our data (prompt-engineered LLM only)
- ❌ No IoT / hardware
- ❌ No real-time data streams

---

## License

UNLICENSED — academic project for university course.

---

## Timeline (per PRD §13)

- **Week 3**: Proposal presentation
- **Week 4-5**: Module 1 + 2 (event form + AI + rule-based)
- **Week 6-7**: Module 3 + 4 (resources + authority dashboard)
- **Week 8**: Checkpoint 1 (lecturer review)
- **Week 9-10**: Module 5 (analytics) + integration testing
- **Week 11-12**: Bug fixes + documentation + demo prep
- **Week 13**: Project demo
- **Week 14**: Final assessment (17 Sep 2026)
