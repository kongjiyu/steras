# M4 队友任务说明

**M4 Incident Reporting and Complaint Handling - Individual Handoff**

## 你的负责范围 | Your Ownership

你负责 during-event/post-event incident reporting 和 complaint ticket lifecycle，并为 M2 提供安全的 verified historical evidence。

**Owned areas:** Incident Pages、Complaint Pages、Evidence、Verification、Eligibility、Investigation、After-action Outcomes。

## 当前进度 | Current Progress

目前只有基础：

- Shared incident/history fields
- Synthetic demo incidents
- Synthetic completed historical outcomes
- M2 retrieval test data
- Authority-only read access for current historical evidence

目前尚未实现 - **Not Implemented:**

- Production M4 routes and pages
- Incident report/verification Functions
- Complaint collection and workflow
- Evidence upload paths and Rules
- Authority investigation queues
- Status/audit history
- M3 notification requests
- M5 real incident/complaint metrics
- End-to-end tests

因此 M4 是当前最大的 **implementation gap**。

## 接下来目标 | Immediate Goal

分成两个可以演示的 **vertical slices**：

1. Incident MVP
2. Complaint MVP

必须先完成 Incident MVP，再开始 Complaint MVP。

## Incident MVP 工作包

1. 定义 final incident types、collections、indexes 和 status transitions。
2. 添加 Firestore Rules、Storage Rules 和 Rules tests。
3. 实现 Organizer incident create/list/detail pages。
4. 实现 Authority incident queue/detail/verification pages。
5. 保存 event ID、version ID、venue ID、event type、reporter、occurred time、location、severity、details 和 evidence。
6. Authority verification 保存 reviewer、timestamp、outcome 和 `assessmentEligible`。
7. 只有 `status: verified` 且 `assessmentEligible: true` 可以进入未来 M2 retrieval。
8. Completed-event outcome 保存 attendance exposure、patient presentations、hospital transfers、resources used、interruptions、near misses 和 after-action findings。

## Complaint MVP 工作包

1. 定义 complaint types、collection、assignment 和 status transitions。
2. 实现 Organizer complaint create/list/detail。
3. 实现 Authority complaint queue、assignment、investigation、response 和 closure。
4. Public-safe update 与 private authority notes 必须分开。
5. Complaint 不可直接改变 M2。
6. Confirmed safety issue 必须建立或链接 separate verified incident。
7. Material updates 产生 M3 notification request。

## 验收条件 | Acceptance Criteria

- Organizer 只能建立或读取自己 event 的 records。
- Authority 只能在 assigned scope 内查看和操作。
- Public 没有 incident/complaint access。
- Evidence private、versioned，并限制 file type/size。
- Unverified、rejected、future 或 ineligible records 不进入 M2 history。
- Complaint 不能直接改变 risk score。
- 所有 material status changes 有 audit trail。

## 需要其他 Module 提供 | Required Inputs

- **M1:** Event/version IDs、organizer ownership、venue ID、event type 和 dates。
- **M3:** Authority identity/scope 和 notification delivery。
- **M2:** Historical retrieval eligibility contract。

## 你需要提供给其他 Module | Outputs

- **M1:** Organizer-visible incident/complaint state 和 public-safe responses。
- **M2:** Verified eligible incident projection、outcomes 和 provenance。
- **M3:** Investigation queues 和 escalation links。
- **M5:** Privacy-safe counts、severity/status、category 和 resolution timestamps。

## 不属于你的工作 | Out of Scope

- 不重新计算旧的 stored M2 assessment。
- 不让 complaint text 直接进入 AI/risk scoring。
- 不公开 incident evidence 或 private complaint notes。
- 不把 synthetic demo records 描述为真实事故。
