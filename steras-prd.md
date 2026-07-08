# **STERAS — Product Requirements Document (PRD) v2.0**

**For: All 5 team members — read this before splitting work.**

**TL;DR: STERAS helps Malaysian authorities (PDRM, Bomba, KKM, DBKL) approve tourism event permits faster using AI prediction (MiniMax M3) \+ rule-based scoring for risk \+ auto-recommended resources. Firebase for backend. Not for tourists. Web app.**

---

## **1\. Project Overview**

### **What**

**STERAS is a B2B/B2G web application that:**

1. **Event organizers submit event details through an online portal (venue, expected attendance, event type, date, duration)**  
2. **System automatically retrieves contextual data — weather forecasts (OpenWeather API), proximity to Malaysian public holidays, venue history**  
3. **System runs two parallel risk assessment engines:**  
   * **AI predictor (MiniMax M3) — contextual reasoning \+ natural language explanation**  
   * **Rule-based engine — deterministic scoring per WHO/PDRM/Bomba standards**  
4. **System compares AI and rule-based scores; if they agree → high confidence; if they disagree by \>= 15 points → flag for manual review**  
5. **System recommends resource allocation (police, medical teams, ambulances, toilets, security, fire officers) using standards from WHO Mass Gathering Guidelines \+ PDRM \+ Bomba**  
6. **Authority officers (PDRM/Bomba/KKM/DBKL) review applications through real-time dashboard (Firebase Firestore listeners), then Approve/Reject/Request Amendment**  
7. **Analytics dashboard tracks trends in event submissions, risk distributions, and resource utilisation**

### **Why this exists (problem statement)**

**Malaysia is promoting Visit Malaysia 2026 (VM2026), with a target of attracting 35.6 million tourist arrivals and organising more festivals, concerts, cultural events, and fairs nationwide. The increasing volume of tourism events creates proportionate pressure on event safety and operational coordination. Currently, the assessment of event risk and the planning of safety resources rely heavily on manual judgement by individual authority officers, often without comprehensive data on historical incidents, real-time conditions, or standardised benchmarks. This leads to:**

1. **Inconsistent risk assessment — Different officers apply different thresholds.**  
2. **Insufficient safety resource planning — Manual calculations prone to error and omission.**  
3. **Lack of data-driven decision support — Historical patterns, weather, venue history not leveraged.**  
4. **Operational consequences — Overcrowding, delayed emergency response, preventable safety incidents (e.g., the Pavilion KL EDM concert death in 2018).**

### **What it's NOT**

* **❌ Not a tourist-facing app**  
* **❌ Not a marketplace (no booking, no transactions)**  
* **❌ Not a trip planner**  
* **❌ Not using crowd detection / image processing (banned by lecturer)**  
* **❌ Not ML-trained on our data — uses prompt-engineered LLM (MiniMax M3) \+ rule-based fallback**  
* **❌ Not pure AI black box — always paired with rule-based deterministic scoring for auditability**

### **SDG alignment**

* **SDG 8: Better resource allocation → decent work for event staff**  
* **SDG 11: Safer events → sustainable cities**  
* **SDG 12: Right-sized resources → responsible consumption (no waste, no shortage)**

---

## **2\. User Roles**

**STERAS has 3 user types:**

### **Role A — Event Organizer**

* **Creates account, submits event applications**  
* **Views own submission status (Pending / Approved / Rejected / Amendment Requested)**  
* **Receives recommendations to improve submission**  
* **Receives real-time dashboard status updates, with Firebase Cloud Messaging as an optional enhancement**

### **Role B — Authority Reviewer**

* **One of: PDRM officer, Bomba officer, KKM officer, DBKL officer, MOTAC officer**  
* **Reviews pending applications in real-time dashboard**  
* **Sees BOTH AI prediction AND rule-based score (for trust \+ audit)**  
* **Actions: Approve / Reject / Request Amendment**  
* **All decisions logged with timestamp \+ authority ID \+ AI-vs-rule agreement flag**

### **Role C — Public Viewer (read-only)**

* **Sees approved events calendar (for tourism awareness)**  
* **No login required**  
* **Helps public know which events are safety-approved**

---

## **3\. System Architecture (high-level)**

**┌─────────────────────────────────────────────────────────┐**

**│                    STERAS Web App                       │**

**├─────────────────────────────────────────────────────────┤**

**│  FRONTEND (React 18 \+ Vite \+ Tailwind CSS)             │**

**│  ┌───────────┬───────────────┬─────────────────┐      │**

**│  │ Organizer │   Authority   │   Public        │      │**

**│  │ Portal    │   Dashboard   │   Calendar      │      │**

**│  └─────┬─────┴───────┬───────┴────────┬────────┘      │**

**│        │             │                │               │**

**│        └─────────────┴────────────────┘               │**

**│              │ Firebase JS SDK \+ react-firebase-hooks  │**

**├─────────────┼──────────────────────────────────────────┤**

**│  FIREBASE BACKEND-AS-A-SERVICE                       │**

**│  ┌────────────────────────────────────────────────┐ │**

**│  │ Firebase Authentication (organizer/authority)  │ │**

**│  │ Firebase Cloud Functions (Node.js 22\)          │ │**

**│  │  ├─ AI Predictor → calls MiniMax M3 API       │ │**

**│  │  ├─ Rule-Based Engine (deterministic)          │ │**

**│  │  └─ Disagreement Detector                       │ │**

**│  │ Firebase Firestore (NoSQL)                     │ │**

**│  │  ├─ events / risk\_scores / resources / audit\_log│ │**

**│  │ Firebase Cloud Storage (uploaded documents)     │ │**

**│  └────────────────────────────────────────────────┘ │**

**├─────────────────────────────────────────────────────────┤**

**│  EXTERNAL APIs                                           │**

**│  ├─ MiniMax M3 (Anthropic-compatible) — AI prediction │**

**│  └─ OpenWeather API — weather forecast data            │**

**└─────────────────────────────────────────────────────────┘**

### **Hybrid AI \+ Rules Architecture (key design decision)**

**A distinctive feature of STERAS is its hybrid risk assessment architecture combining AI prediction with deterministic rule-based scoring. This design:**

* **AI Predictor (MiniMax M3): Provides contextual reasoning with natural language explanation, e.g., "Large outdoor crowd with severe weather forecast significantly increases risk of crowd crush and weather-related incidents."**  
* **Rule-Based Engine: Always runs the deterministic answer using WHO/PDRM/Bomba standards.**  
* **Disagreement Detector: If AI and rule-based scores differ by \>= 15 points, the application is flagged for manual review by a senior authority.**

**This hybrid design addresses three concerns:**

1. **Audit trail — Authority decisions need justification. Rule-based outputs are deterministic and explainable.**  
2. **AI hallucination mitigation — Per academic reviews of LLM applications in safety-critical domains, AI models can produce inconsistent or fabricated recommendations. The rule-based engine provides a ground-truth check.**  
3. **Lecturer fit — Per Lecture 1 commentary, the lecturer favors "prediction-based solutions", making AI prediction a strong fit, while the rule-based component provides the deterministic accuracy expected of a safety tool.**

---

## **4\. The 5 Modules — What Each Does**

### **Module 1: Event Management (Owner: Requirement Lead)**

**Purpose: Organizer submits event application \+ tracks status.**

**Features:**

* **Event submission form (event name, type, venue, address, GPS, capacity, expected attendance, start/end datetime, description, organizer contact)**  
* **Manual venue input (Google Places API auto-fill is optional / nice-to-have)**  
* **My Events dashboard (status: Pending / Under Review / Approved / Rejected / Amendment Requested)**  
* **Edit / withdraw application (only if Pending)**  
* **Real-time status updates via Firestore listeners**

**Inputs (per event):**  
 **| Field | Type | Required |**  
 **|---|---|---|**  
 **| Event name | text | Yes |**  
 **| Event type | dropdown | Yes |**  
 **| Venue name | text | Yes |**  
 **| Venue address | text | Yes |**  
 **| Venue GPS | lat/lng | Optional (auto-fill from address) |**  
 **| Venue capacity | number | Yes |**  
 **| Expected attendance | number | Yes |**  
 **| Start datetime | datetime | Yes |**  
 **| End datetime | datetime | Yes |**  
 **| Description | textarea | Optional |**  
 **| Organizer name | text | Yes |**  
 **| Organizer contact | phone \+ email | Yes |**

**Outputs: Event record stored in Firestore, triggers Module 2 \+ 3 (Cloud Functions).**

---

### **Module 2: Smart Risk Assessment (Owner: Programmer)**

**Purpose: Calculate risk score using two parallel engines (AI \+ rules) \+ detect disagreement.**

**Inputs (from Module 1 \+ external data):**

* **Event details (attendance, type, venue, duration)**  
* **Weather forecast (OpenWeather API)**  
* **Public holiday proximity (auto-detect from JSON file)**  
* **Day of week (weekend \= higher risk)**  
* **Historical incident lookup (Firestore collection of past incidents per venue / event type)**  
* **Venue capacity utilization (attendance / capacity ratio)**

**Rule-based scoring formula (deterministic, always runs):**

**risk\_score \= 0.30 × weather\_score**

           **\+ 0.25 × crowd\_score**

           **\+ 0.20 × venue\_score**

           **\+ 0.15 × history\_score**

           **\+ 0.10 × holiday\_score**

**AI prediction (MiniMax M3 prompt):**

**System: You are an event safety risk assessment expert for Malaysian tourism events.**

**Output structured JSON with risk\_level (Low/Medium/High), risk\_score (0-100),**

**reasoning, key\_concerns, and recommended\_resources.**

**User: { event details \+ weather \+ holiday \+ venue history }**

**Assistant: {**

  **"risk\_level": "High",**

  **"risk\_score": 78,**

  **"reasoning": "...",**

  **"key\_concerns": \["thunderstorm", "outdoor\_uncovered", "high\_attendance"\],**

  **"recommended\_resources": { "police": 25, "medical": 6, "ambulances": 2, ... }**

**}**

**Outputs:**

* **AI risk score (with reasoning) \+ Rule-based risk score**  
* **Disagreement flag (if |AI \- Rule| \>= 15\)**  
* **Triggers Module 3 for resource calculation**

---

### **Module 3: Safety Resource Recommendation (Owner: Design Lead)**

**Purpose: Recommend resource allocation based on risk \+ attendance \+ WHO/PDRM/Bomba standards.**

**Inputs (from Module 1 \+ Module 2):**

* **Event details (attendance, type, venue capacity)**  
* **Risk score (from Module 2 — both AI and rule-based, plus disagreement flag)**

**Resource formulas (cite real standards):**

| Resource | Formula | Standard |
| ----- | ----- | ----- |
| **Police officers** | **max(2, attendance ÷ 250\) \+ (10 if risk=High)** | **Prototype formula adapted from mass gathering safety benchmarks; final values require authority validation** |
| **Medical teams** | **max(1, attendance ÷ 1000\) \+ (1 if risk=High)** | **WHO Mass Gathering Guidelines / prototype benchmark** |
| **Ambulances on-site** | **max(1, attendance ÷ 5000\)** | **Prototype formula adapted from emergency planning benchmarks; final values require authority validation** |
| **Portable toilets** | **attendance ÷ 50 (women) \+ attendance ÷ 75 (men)** | **Standard event planning benchmark** |
| **Waste bins** | **attendance ÷ 100** | **Event management best-practice estimate** |
| **Security personnel** | **attendance ÷ 100 (general) \+ (event type multiplier: concert=2x)** | **Crowd management benchmark; final values require authority validation** |
| **Fire safety officers** | **max(1, attendance ÷ 500\) \+ (1 if indoor)** | **Prototype formula adapted from fire safety planning benchmarks; final values require authority validation** |

**AI-augmented recommendation (optional override):**

* **If AI and rule-based agree → use rule-based answer**  
* **If AI and rule-based disagree significantly → present BOTH to authority for manual decision**  
* **AI's `recommended_resources` field overrides only with explicit authority approval**

**Outputs:**

* **Recommended resource list with quantities \+ standards reference**  
* **Confidence flag (if standards are estimates vs official)**  
* **Saved as part of event record for audit**

---

### **Module 4: Authority Dashboard (Owner: Programmer \+ Design Lead)**

**Purpose: Authority reviews pending applications \+ makes decisions (with AI \+ rule-based comparison).**

**Features:**

* **Login (Firebase Auth, role-based: only Authority users)**  
* **Pending Applications queue (Firestore real-time listener)**  
* **Application detail view:**  
  * **Organizer info \+ event details (read-only)**  
  * **AI Risk Analysis with reasoning**  
  * **Rule-Based Risk Score (for comparison)**  
  * **Disagreement Flag (if AI and rule-based differ by \>= 15)**  
  * **Resource Recommendations (with standards cited)**  
  * **Decision buttons: Approve / Reject / Request Amendment**  
* **Amendment form (free text \+ specific resource changes suggested)**  
* **Decision history per event (audit log)**  
* **Filter by risk level / event type / date**  
* **Search by organizer name or event name**

**Decision workflow:**

1. **Authority opens application**  
2. **Sees AI risk \+ reasoning \+ rule-based score side-by-side**  
3. **If agreement → high confidence, quick decision**  
4. **If disagreement → reads AI reasoning, checks venue history, may request amendment**  
5. **Makes decision (Approve / Reject / Request Amendment)**  
6. **System updates organizer dashboard status in real time; optional FCM notification if implemented**  
7. **Decision logged with timestamp \+ authority ID \+ AI-vs-rule agreement status**

---

### **Module 5: Analytics & Reporting (Owner: Tester)**

**Purpose: Show trends \+ statistics for future planning.**

**Features:**

* **Dashboard with charts (Chart.js):**  
  * **Events approved per month (line chart)**  
  * **AI vs Rule-based agreement rate (pie chart — % agree / % disagree)**  
  * **Average risk score over time (line chart)**  
  * **Risk level distribution (pie chart: Low / Medium / High)**  
  * **Most common event types (bar chart)**  
  * **Resource recommendations vs actual usage comparison**  
* **Filter by date range / event type / risk level**  
* **Export to CSV / PDF**  
* **"Top risky venues" list (most flagged for high risk)**  
* **"Most disagreed applications" list (where AI and rule-based diverged — for authority training)**

---

## **5\. User Flows (Key Scenarios)**

### **Flow 1: Organizer submits event**

1. **Organizer logs in (Firebase Auth)**  
2. **Clicks "New Event"**  
3. **Fills form (Module 1\)**  
4. **Submits → event goes to Pending in Firestore**  
5. **Cloud Function triggers: weather fetch \+ AI prediction \+ rule-based scoring**  
6. **Organizer sees "AI: 78 (High) | Rule: 72 (High) | Agreement: Yes | Recommended: 8 police, 2 medical teams, 40 toilets"**  
7. **Organizer waits for authority decision**  
8. **Authority reviews (Flow 2\)**  
9. **Organizer sees real-time status update in the dashboard**  
10. **If FCM is implemented, organizer also receives a push notification**

### **Flow 2: Authority reviews application**

1. **Authority logs in (Firebase Auth)**  
2. **Sees Pending Applications queue (Firestore real-time, no refresh needed)**  
3. **Filters by risk level \= High (shows 3 events)**  
4. **Clicks on event \#1**  
5. **Sees full details: organizer \+ event \+ AI risk (with reasoning) \+ rule-based score \+ resources \+ standards**  
6. **Notices AI \= 85, Rule \= 70 (disagreement of 15 — flagged for manual review)**  
7. **Reads AI reasoning: "Venue has had 2 medical emergencies in past 6 months, and recent heavy rain may affect temporary outdoor structures"**  
8. **Checks venue history (Firestore sub-collection)**  
9. **Decides "AI is right, request amendment" → clicks "Request Amendment"**  
10. **Fills form: "Reduce police to 8, increase medical to 3, require pre-event roof inspection"**  
11. **Submits amendment request**  
12. **Organizer sees the amendment request in the dashboard and can resubmit; optional FCM notification if implemented**

### **Flow 3: Public sees approved events**

1. **Public visits STERAS homepage (no login)**  
2. **Sees calendar of approved events (Firestore public read-only collection)**  
3. **Clicks on event → sees basic info (name, venue, date, "Safety-approved by PDRM")**  
4. **(Optional) Sees aggregate risk stats for that event type**

---

## **6\. Data Sources**

### **Real (external APIs)**

* **✅ Weather: OpenWeather API (free tier, 1000 calls/day)**  
* **✅ AI Prediction: MiniMax M3 API (Anthropic-compatible, in `~/.hermes/.env`)**

### **Synthetic (for prototype)**

* **🟡 Historical incident data: Generate synthetic dataset based on realistic distributions**  
* **🟡 Venue database: Start with 20-30 sample venues**

### **Manual input**

* **🟡 Organizer provides venue, attendance, etc.**  
* **🟡 Authority reviews \+ decides**  
* **🟡 Standards reference table (manually curated from WHO/PDRM/Bomba docs)**

---

## **7\. Firestore Data Model & Access Control**

### **Core collections**

| Collection | Purpose | Key fields |
| ----- | ----- | ----- |
| **users** | Stores registered user profiles and role metadata | **uid, name, email, role, authorityType, createdAt** |
| **events** | Main event application records submitted by organizers | **eventId, organizerId, eventDetails, status, createdAt, updatedAt** |
| **events/{eventId}/risk\_scores** | Stores AI and rule-based risk results for each event | **aiScore, ruleScore, riskLevel, disagreementFlag, aiReasoning, promptVersion** |
| **events/{eventId}/resources** | Stores recommended safety resource quantities | **police, medicalTeams, ambulances, toilets, security, fireOfficers, confidenceLevel** |
| **events/{eventId}/audit\_logs** | Immutable history of authority decisions and system actions | **action, actorId, actorRole, timestamp, previousStatus, newStatus, notes** |
| **venues** | Prototype venue database for lookup and history linkage | **venueId, name, address, capacity, location, riskNotes** |
| **incidents** | Synthetic historical incident data for prototype scoring | **incidentId, venueId, eventType, incidentType, severity, date** |
| **public\_events** | Read-only approved event calendar for public viewers, if implemented | **eventName, venueName, date, publicStatus** |

### **Access control rules**

* **Organizers can create events and read/update only their own events while status is Pending or Amendment Requested.**  
* **Authority users can read submitted event applications and create decision records, but cannot directly edit immutable audit logs.**  
* **Public viewers can read only approved public event summaries from `public_events`; they cannot access organizer contact details, AI prompts, audit logs, or internal risk reasoning.**  
* **Cloud Functions are responsible for writing risk scores, resource recommendations, audit logs, and status transitions that require server-side validation.**  
* **Firestore Security Rules enforce role-based access using Firebase Auth custom claims or a trusted `users` role document.**

---

## **8\. Module Dependencies (Build Order)**

**Module 1 (Event Mgmt) → Module 2 (Risk) → Module 3 (Resources) → Module 4 (Dashboard) → Module 5 (Analytics)**

**Recommended build order:**

1. **Module 1 (event form \+ Firestore schema)**  
2. **Module 2 (AI \+ rule-based engines, Cloud Functions)**  
3. **Module 3 (resource formula engine)**  
4. **Module 4 (authority dashboard \+ real-time listeners)**  
5. **Module 5 (analytics — last because depends on data from others)**

---

## **9\. Team Role Assignments (UNCHANGED from v1)**

| Module | Lead | Support |
| ----- | ----- | ----- |
| **Module 1: Event Management** | **Requirement Lead** | **Project Manager (for stakeholder interview)** |
| **Module 2: Smart Risk Assessment** | **Programmer** | **Design Lead (scoring formula \+ AI prompt design)** |
| **Module 3: Safety Resource Recommendation** | **Design Lead** | **Programmer (formula implementation)** |
| **Module 4: Authority Dashboard** | **Programmer** | **Design Lead (UI/UX), Tester** |
| **Module 5: Analytics & Reporting** | **Tester** | **Programmer (chart integration)** |

---

## **10\. Tech Stack (REVISED — Firebase \+ AI)**

### **Frontend**

* **React 18 \+ Vite (fast dev experience)**  
* **Tailwind CSS (rapid styling)**  
* **Firebase JS SDK \+ react-firebase-hooks (real-time listeners)**  
* **Chart.js (analytics module)**

### **Backend (Firebase Backend-as-a-Service)**

* **Firebase Authentication (email/password, OAuth)**  
* **Firebase Cloud Functions (Node.js 22 runtime)**  
* **Firebase Firestore (NoSQL document database, real-time)**  
* **Firebase Cloud Storage (uploaded documents)**  
* **Firebase Cloud Messaging (optional push notifications; nice-to-have)**

### **AI / External APIs**

* **MiniMax M3 (Anthropic-compatible LLM) for risk \+ resource prediction**  
* **OpenWeather API for weather forecast data**  
* **Static JSON file for Malaysian public holidays**

### **Dev Tools**

* **Git \+ GitHub (version control)**  
* **VS Code (code editor)**  
* **Firebase Emulator Suite (local testing)**  
* **Postman (API testing for Cloud Functions)**  
* **@anthropic-ai/sdk (works with MiniMax's Anthropic-compatible API)**

---

## **11\. Constraints & Non-Goals**

### **Hard constraints**

* **❌ No image processing / crowd detection (banned by lecturer)**  
* **❌ No real ML model (use prompt-engineered LLM only)**  
* **❌ No IoT / hardware (pure software)**  
* **❌ No real-time data streams (historical/scheduled data only)**

### **Out of scope (for MVP)**

* **Real payment integration**  
* **Real SMS/email notifications (MVP uses in-app status updates; Firebase Cloud Messaging is nice-to-have)**  
* **Multi-language support (English only)**  
* **Mobile app (web only)**  
* **Advanced user roles / permissions (3 simple roles)**  
* **Real PDRM/Bomba system integration (mock data only)**

### **Hybrid AI \+ Rules design rules**

* **⚠️ AI prediction NEVER replaces rule-based — it augments**  
* **⚠️ Disagreement \>= 15 points → flag for manual review (no auto-decision)**  
* **⚠️ All AI outputs logged with prompt \+ response for audit**  
* **⚠️ Rule-based engine always computes the deterministic answer (ground truth)**

---

## **12\. Success Criteria (for proposal \+ Week 13 demo)**

### **Must-have (MVP)**

* **Organizer can register, login, submit event**  
* **System calculates BOTH AI risk score \+ rule-based score**  
* **System flags disagreement \>= 15 points**  
* **System recommends resource quantities with standards cited**  
* **Authority can review application \+ see AI reasoning \+ rule-based score side-by-side**  
* **Authority can Approve/Reject/Amend**  
* **Audit log captures all authority decisions**  
* **Analytics dashboard with at least 3 charts (including AI vs rule agreement rate)**  
* **Real-time updates via Firestore listeners (no manual refresh needed)**  
* **Works on Chrome / Edge / Safari**  
* **Mobile-responsive**

### **Nice-to-have (if time permits)**

* **FCM push notifications to organizer on decision**  
* **Public calendar view (no login)**  
* **CSV export of analytics**  
* **Sample dataset of 10-20 events for demo**

### **Will NOT have (out of scope)**

* **Real PDRM database integration**  
* **Real-time crowd monitoring**  
* **Native mobile app**  
* **Multi-tenancy**  
* **Multi-language support**

---

## **13\. Timeline (8-week rough plan — UNCHANGED)**

| Week | Milestone |
| ----- | ----- |
| **Week 3** | **Proposal presentation** |
| **Week 4-5** | **Module 1 \+ 2 build (event form \+ AI \+ rule-based engines)** |
| **Week 6-7** | **Module 3 \+ 4 build (resources \+ authority dashboard with real-time listeners)** |
| **Week 8** | **Checkpoint 1 (lecturer review)** |
| **Week 9-10** | **Module 5 (analytics) \+ integration testing** |
| **Week 11-12** | **Bug fixes \+ documentation \+ demo prep** |
| **Week 13** | **Project Demo presentation** |
| **Week 14** | **Final Assessment Documentation (due 17 Sep 2026, 11:59 PM)** |

---

## **14\. Risks & Mitigations (REVISED)**

| Risk | Mitigation |
| ----- | ----- |
| **AI hallucination / inconsistency** | **Rule-based engine always provides ground truth; disagreements \>= 15 flagged for manual review** |
| **MiniMax API cost overrun** | **Cloud Function rate limits (max 1000 calls/day); cache repeated identical requests** |
| **MiniMax API downtime** | **Rule-based engine continues working without AI; system degrades gracefully** |
| **Firebase quota exceeded** | **Monitor usage; set budget alerts at 50%/80% of planned prototype budget/quota** |
| **Firestore NoSQL denormalization complexity** | **Design collections carefully; use sub-collections for related data (e.g., risk\_scores as sub-collection of events)** |
| **AI prompt engineering iteration** | **Allocate extra time in Week 4-5 for prompt tuning; test with 20+ sample events** |
| **Real PDRM/Bomba system integration** | **Out of scope; use mock data for prototype** |

---

## **15\. References (verified open-access papers)**

### **Risk Assessment Theory**

1. **Arbon, P., Bridgewater, F., & Smith, C. (2011). *Mass-gathering event risk scoring model: A score to predict risk level and medical usage rate during metropolitan mass gatherings.* Prehospital and Disaster Medicine, 26(Suppl. 1), s109. [https://doi.org/10.1017/s1049023x11002585](https://doi.org/10.1017/s1049023x11002585) — PDF in vault (`papers_pdf/Arbon_2011_MG_Risk_Scoring.pdf`)**  
2. **Khalid, S., et al. (2022). *Crowd risk prediction in a spiritually motivated crowd.* Safety Science, 154, 105857\. [https://doi.org/10.1016/j.ssci.2022.105857](https://doi.org/10.1016/j.ssci.2022.105857) — PDF in vault (`papers_pdf/Crowd_Risk_Prediction_2022.pdf`)**

### **AI \+ Rule-Based Hybrid**

3. **Ryan, M. (2026). *Behavior rule architecture: Rule-based governance of AI system behavior.* TechRxiv. [https://doi.org/10.31224/6681](https://doi.org/10.31224/6681) — PDF in vault (`papers_pdf/Rule_Based_AI_Governance.pdf`)**  
4. **Vassilev, V., & Bogdanova, M. (2026). *An integrated GNN-LLM framework for automated task-level safety risk assessment.* SSRN. [https://doi.org/10.2139/ssrn.6532324](https://doi.org/10.2139/ssrn.6532324)**

### **Firebase**

5. **Chang, J. (2020). *firebase: Integrates 'Google Firebase' authentication, storage, and 'Analytics' into R* (R package documentation). CRAN. [https://cran.r-project.org/web/packages/firebase/firebase.pdf](https://cran.r-project.org/web/packages/firebase/firebase.pdf) — PDF in vault (`papers_pdf/firebase_R_package_doc.pdf`)**  
6. **Khan, A., et al. (2023). *Design monitoring and control of dam gate based on Visual Studio with Google Firebase real-time database*. Universal Journal of Physics and Application, 10(2), 1062\. [https://doi.org/10.21070/ups.1062](https://doi.org/10.21070/ups.1062) — PDF in vault (`papers_pdf/Firebase_Dam_Gate_Visual_Studio.pdf`)**  
7. **Wijaya, Y. (2023). *About "Golden Race DB" development (NoSQL DBMS) as an alternative of Google Firebase*. Herald of Science, 26(4), 498-517. [https://doi.org/10.26907/1562-5419-2023-26-4-498-517](https://doi.org/10.26907/1562-5419-2023-26-4-498-517) — PDF in vault (`papers_pdf/Golden_Race_NoSQL_Alternative.pdf`)**

### **Web Application Architecture**

8. **Pandey, R., et al. (2024). *MERN (MongoDB, Express-JS, React-JS, Node-JS) stack web-based themefied educational platform*. Educational Administration: Theory and Practice, 30(5), 3035\. [https://doi.org/10.53555/kuey.v30i5.3035](https://doi.org/10.53555/kuey.v30i5.3035) — PDF in vault (`papers_pdf/MERN_Stack_Educational.pdf`)**  
9. **Tarasov, K. (2018). *React framework (creating a web application with React Native)*. International Journal of Recent Trends in Engineering and Research, 4(11), 4176\. [https://doi.org/10.23883/ijrter.2018.4176.npvsn](https://doi.org/10.23883/ijrter.2018.4176.npvsn)**

### **Weather API**

10. **Rohmah, S., et al. (2025). *Real-time weather forecast website using OpenWeather API*. Scientific Journal of Artificial Intelligence and Blockchain Technology, 2(3), 207\. [https://doi.org/10.63345/sjaibt.v2.i3.207](https://doi.org/10.63345/sjaibt.v2.i3.207) — PDF in vault (`papers_pdf/OpenWeather_Real_Time.pdf`)**

---

## **16\. Open Questions (to discuss with team)**

1. **AI prompt strategy: How detailed should the system prompt be? Recommend a "role \+ standards \+ JSON format" template that all queries follow.**  
2. **MiniMax cost monitoring: Who monitors API usage daily? Set up budget alerts?**  
3. **Firebase project setup: Who creates the Firebase project? Need Google Cloud account access.**  
4. **Test data: Need 20-30 sample event applications for testing. Generate or use real (anonymized) past events?**  
5. **AI vs rule-based authority interface: How prominently do we show the two scores side-by-side? Or hide rule-based behind a "show details" toggle?**

---

**End of PRD v2.0. Next step: team review, then start Module 1 build.**
