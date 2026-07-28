# STERAS 团队目前进度与目标

**Team Progress and Goals**

本文件以华语解释为主，并保留重要的 **English keywords**，方便团队进行开发沟通、报告撰写和展示。

## 1. 项目整体目标 | Team Objective

完成一个可以完整展示的 **end-to-end prototype**：

> Event Organiser 提交活动申请，M2 完成风险评估，Authority Officers 进行人工审核，M4 记录事故与投诉，M5 提供可以审计的分析报告。

每位队友负责一个完整的 **vertical slice**，包括：

- 页面与交互 - **Pages and UI**
- 共用数据类型 - **Shared Types**
- Firebase Cloud Functions - **Backend Logic**
- Firestore/Storage Rules - **Access Control**
- Loading、Empty、Error、Permission states
- Unit、Rules、Browser 和 Emulator tests
- Module documentation 与 integration handoff

## 2. 当前整体进度 | Current Project Progress

### M1 - User and Event Management

**目前状态 - Current Status:** 已有完整基础 - **Implemented Foundation**

已经实现：

- Organizer registration/login 与 **role-based access**
- Organizer dashboard 和 event application form
- Verified venue selector 与 custom venue input
- Draft saving、document upload、submission 和 withdrawal
- Event list、event detail 和 real-time status
- Public calendar 和 sanitised public event detail
- Submission/withdrawal Functions 与基本 Firestore/Storage Rules

主要缺口 - **Main Gaps:**

- 完整 lifecycle 的 **end-to-end UAT**
- Revision Requested 后的 edit/resubmit 验证
- M3 notification presentation
- M4 incident/complaint navigation
- 更完整的 browser 与 cross-organiser permission tests

### M2 - Smart Risk Assessment and Safety Resource Recommendation

**目前状态 - Current Status:** 当前最完整 - **Most Complete Module**

已经实现：

- Eight-domain **all-hazards assessment**
- DOSH HIRARC likelihood x severity
- Official residual risk、readiness、compliance 和 confidence
- Evidence provenance 与 verified-control handling
- Weather、calendar、venue 和 comparable history retrieval
- MiniMax advisory analysis 与 fallback
- Prototype resource baseline 和 planning ranges
- Authority risk/resource pages
- Synthetic emulator demo dataset
- Engine tests、Rules coverage 和 external-service verification

主要缺口 - **Main Gaps:**

- M3 verified-control reviewer provenance
- M4 real incident and completed-event outcomes
- PDRM/BOMBA/KKM resource-assumption validation
- Final cross-module integration

### M3 - Authority Approval and Notification

**目前状态 - Current Status:** 审核基础已完成 - **Working Review Foundation**

已经实现：

- Authority dashboard 和 assigned review queue
- Authority event review 与 evidence download
- Scoped authority decisions 和 decision history
- Multi-authority aggregation
- Resource override 与 audit writes
- Unanimous approval 后发布 sanitised `public_events`

主要缺口 - **Main Gaps:**

- Durable in-app notifications
- Verified-control workflow
- M2 readiness/compliance decision gates
- Standalone audit user experience
- 所有 decision branches 的完整 UAT

### M4 - Incident Reporting and Complaint Handling

**目前状态 - Current Status:** 大部分尚未实现 - **Largest Missing Module**

已经存在：

- Shared incident/history fields
- Synthetic demo incidents 和 historical outcomes
- M2 historical-retrieval test data
- Authority-only read protection for current historical evidence

尚未实现：

- Production routes and pages
- Incident report/verification Functions
- Complaint collection and workflow
- Incident/complaint evidence upload contract
- Complete Firestore/Storage Rules
- M3 notifications 和 M5 integration
- End-to-end tests

### M5 - Analytics and Reporting

**目前状态 - Current Status:** 可运行基础 - **Working Analytics Foundation**

已经实现：

- Authority-scoped reports page
- Date filter
- Monthly application/approval trends
- Official-risk distribution
- Monthly average official score
- AI agreement、fallback rate 和 turnaround summary
- CSV export 与基础 spreadsheet-formula neutralisation
- Analytics helper unit tests

主要缺口 - **Main Gaps:**

- Event type、venue、risk、status、authority 和 schema filters
- Readiness/compliance/confidence analytics
- Resource/override/re-application metrics
- M4 incident/complaint metrics
- Synthetic-data exclusion by default
- Server-generated or bounded aggregation
- 更完整的 privacy/export tests

### General Integration

**目前状态 - Current Status:** Integration foundation 已存在

已经实现：

- Role-protected routing
- Shared layouts、navigation 和 UI primitives
- Dashboard preview
- Module/page ownership documentation
- Emulator、seed 和 integration scripts

主要缺口 - **Main Gaps:**

- Final cross-module navigation
- Shared-contract conflict management
- End-to-end release walkthrough
- Coordinated deployment

## 3. 每位队友接下来的目标 | Immediate Goals

## M1 队友 | M1 Teammate

### 目标 | Goal

完成并验证 Organizer 的完整 **application lifecycle**，不要重新设计已经存在的页面。

### 工作包 | Work Package

1. 同步 `NewEvent.tsx`、`EventDetails`、`EventRiskProfile` 和 `submitEvent.ts` validation。
2. 验证 draft、version-scoped upload、immutable submission、revision resubmission 和 withdrawal。
3. 完成 loading、empty、error、permission、mobile states。
4. 提供可以读取 M3 notification records 的 organiser UI。
5. 验证 `public_events` 不包含 PII、private evidence、risk、incident 或 complaint data。
6. 添加 organiser golden-path 和 forbidden cross-user browser tests。

### 验收 | Acceptance

- 完整演示 register -> draft -> upload -> submit -> revision -> resubmit。
- Submitted version 无法编辑。
- 其他 organiser 无法读取申请和 evidence。
- 只有 Approved 的 sanitised event 会公开显示。

### 交接 | Handoff

- 从 M2 读取 assessment/resource records。
- 从 M3 读取 decision/notification records。
- 提供 stable event/version/organiser/venue IDs 给 M4。

## M2 负责人兼 General Integrator

### 目标 | Goal

稳定现有 **all-hazards v2 contract** 并支持其他 modules integration，不再进行新的 scoring redesign。

### 工作包 | Work Package

1. 维护 deterministic HIRARC、readiness、compliance、confidence 和 verified controls。
2. 维持 MiniMax **advisory-only** 和 safe fallback。
3. 维护 normalized history retrieval 和 synthetic-data provenance。
4. 将 resource quantities 保持为 prototype planning ranges。
5. 提供 fixtures、contract examples 和 integration support。
6. 负责 General routing、shared visual consistency、release checks 和 conflict resolution。

### 验收 | Acceptance

- 相同 immutable input 产生相同 official result。
- AI failure 不会改变 official risk。
- Synthetic history 不会被当作 real accuracy evidence。
- Full checks、Rules tests、external-service verification 和 emulator submission 通过。

### 交接 | Handoff

- M3 提供 verified-control reviewer provenance。
- M4 提供 verified incidents 和 completed outcomes。
- M5 分开统计 risk、readiness、compliance、confidence 和 synthetic status。

## M3 队友 | M3 Teammate

### 目标 | Goal

完成真正的 **human authority review workflow**。

### 工作包 | Work Package

1. 阻止 `complianceStatus: blocked` 的申请被批准。
2. Provisional/insufficient-data assessment 必须有 reviewer rationale。
3. 实现 server-mediated control verification，记录 control ID、authority、reviewer、evidence、timestamp 和 version。
4. 保留 version-scoped decisions 和 resource overrides。
5. 实现 idempotent `notifications/{notificationId}`。
6. 添加 organiser notification Rules 和 M1 display contract。
7. 测试 unanimous approval、rejection precedence、revision precedence、concurrency 和 resubmission。

### 验收 | Acceptance

- Authority 只能看到 assigned applications。
- Blocked compliance 不能 Approved。
- 只有 same-version unanimous approval 才能公开活动。
- Decision、override、control verification 和 notification 全部可审计。

### 交接 | Handoff

- 不修改 M2 score 或 AI output。
- 提供 decision/notification fields 给 M1。
- 提供 review stage、timestamps、override 和 publication outcome 给 M5。

## M4 队友 | M4 Teammate

### 目标 | Goal

分两个 **vertical slices** 实现：先完成 Incident MVP，再完成 Complaint MVP。

### Incident MVP

1. 建立 incident types、collections、indexes 和 Rules。
2. 实现 organiser incident create/list/detail。
3. 实现 authority verification queue 和 eligibility control。
4. 保存 event/version/venue、time、severity、evidence、outcome、reporter 和 reviewer provenance。
5. 只有 `verified + assessmentEligible` incidents 可以进入未来 M2 assessment。
6. 保存 attendance exposure、medical outcomes、resources used、interruptions、near misses 和 after-action findings。

### Complaint MVP

1. 实现 organiser complaint create/list/detail。
2. 实现 authority assignment、investigation、public-safe update 和 resolution。
3. Complaint 不可以直接改变 M2；confirmed safety event 必须链接 verified incident。
4. Material update 产生 notification request。

### 验收 | Acceptance

- Organiser 只能访问自己 event 的 records。
- Authority 只能在 assigned scope 内行动。
- Evidence private and versioned。
- Unverified/rejected/future/ineligible incidents 不进入 M2 history。
- 所有 status changes 都有 audit trail。

### 交接 | Handoff

- 使用 M1 identifiers 和 M3 authority scope。
- 提供 verified historical projection 给 M2。
- 只提供 privacy-safe metrics 给 M5。

## M5 队友 | M5 Teammate

### 目标 | Goal

把现有 analytics foundation 扩展成完整、可审计和 privacy-safe 的报告功能。

### 工作包 | Work Package

1. 记录每个 metric 的 formula、source fields、denominator、exclusions 和 unavailable rule。
2. 添加 readiness、compliance、confidence、resources、overrides、decisions、turnaround 和 re-application views。
3. 提供 AI success/fallback coverage 和 AI-vs-deterministic agreement。
4. 在 M4 数据未完成时明确显示 **Data Not Available**。
5. 默认排除 synthetic records，并提供 demo-data filter。
6. 添加 date、event type、venue、risk、status、authority 和 schema filters。
7. 加强 CSV export 的 PII exclusion 和 formula-injection tests。
8. 使用 bounded queries 或 server-generated snapshots。

### 验收 | Acceptance

- 每个 PRD metric 正确显示或明确解释 unavailable reason。
- Insufficient data 不会被统计为 Low risk。
- Analytics authority-scoped、schema-aware、reproducible、privacy-safe。
- CSV/PDF export 不包含 restricted fields。

### 交接 | Handoff

- 所有 upstream records 都是 read-only source data。
- Analytics output 不可以用于改变 business decision。

## 4. 推荐整合顺序 | Recommended Integration Order

1. M1、M3、M4、M5 使用现有 **demo dataset** 独立开始。
2. M3 发布 notification 和 verified-control interfaces。
3. M4 发布 verified-incident 和 completed-outcome interfaces。
4. M1 连接 notifications 和 M4 navigation。
5. M5 接入 M3/M4 fields，同时保留 unavailable states。
6. General 执行 full end-to-end integration 和 release gates。

## 5. 共用完成标准 | Shared Definition of Done

- PRD requirement IDs 可以追踪到 code 和 tests - **Traceability**
- Auth/Rules 阻止跨用户和跨 authority access - **Security**
- Loading、empty、error、permission、mobile、keyboard states 完成 - **UX Resilience**
- 不提交 API keys、PII 或 service-account files - **Secrets and Privacy**
- `npm run check` 和 `npm run test:rules` 通过 - **Quality Gates**
- 每位 owner 提供 emulator demo 或 recorded walkthrough - **Handoff Evidence**
