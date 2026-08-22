# M4 队友任务说明

**Incident Reporting and Handling - Individual Handoff**

## 你的负责范围 | Your Ownership

你负责完整的 incident lifecycle：reporting、admin triage、assignment、investigation、resolution、verification，并为 M2 提供安全的 verified historical evidence。

**Owned areas:** Incident Pages、Evidence、Triage、Assignment、Investigation、Resolution、Verification、Assessment Eligibility、After-action Outcomes。

## 当前进度 | Current Progress

目前已有：

- Shared incident/history fields
- Synthetic demo incidents
- Synthetic completed historical outcomes
- M2 retrieval test data
- Authority-only read access for current historical evidence

目前尚未实现 - **Not Implemented:**

- Production M4 routes and pages
- Incident report/triage/assignment/verification Functions
- Evidence upload paths and Rules
- Authority investigation queue
- Status and audit history
- M3 notification requests
- M5 real incident metrics
- End-to-end tests

因此 M4 是当前最大的 **implementation gap**。

## 接下来目标 | Immediate Goal

完成一个可以演示的 **Incident Handling Vertical Slice**：

`Submit Report → Admin Triage → Close with Reason / Assign for Action → Investigate → Resolve → Verify for Future Evidence`

## 工作包 | Work Package

1. 定义 final incident types、collection、indexes 和 status transitions。
2. 添加 Firestore Rules、Storage Rules 和 Rules tests。
3. 实现 Organizer incident create/list/detail pages。
4. 实现 Authority incident queue/detail 和 admin triage。
5. 当 `actionRequired: false`，必须记录 justification 后才能 Close。
6. 当 `actionRequired: true`，assign 给 relevant organiser 或 authority officer。
7. Assigned party 记录 response actions、investigation findings、evidence 和 final outcome。
8. Authority verification 保存 reviewer、timestamp、`verified` 和 `assessmentEligible`。
9. 只有 `verified: true` 且 `assessmentEligible: true` 才能进入未来 M2 retrieval。
10. Completed-event outcome 保存 attendance exposure、patient presentations、hospital transfers、resources used、interruptions、near misses 和 after-action findings。
11. Material updates 产生 M3 notification request，并提供 privacy-safe fields 给 M5。

## Status 建议 | Suggested Statuses

`Submitted | UnderReview | ActionRequired | Investigating | Resolved | Closed`

## 验收条件 | Acceptance Criteria

- Organizer 只能建立或读取自己 event 的 incident records。
- Authority 只能在 assigned scope 内查看和操作。
- Public 没有 incident access。
- Evidence private、versioned，并限制 file type/size。
- No-action decision 有 admin、timestamp 和 justification。
- Action-required incident 可以 assign、investigate、resolve。
- Unverified、future 或 ineligible records 不进入 M2 history。
- 所有 material status changes 有 audit trail。

## 需要其他 Module 提供 | Required Inputs

- **M1:** Event/version IDs、organizer ownership、venue ID、event type 和 dates。
- **M3:** Authority identity/scope 和 notification delivery。
- **M2:** Historical retrieval eligibility contract。

## 你需要提供给其他 Module | Outputs

- **M1:** Organizer-visible incident status 和 resolution history。
- **M2:** Verified eligible incident projection、outcomes 和 provenance。
- **M3:** Triage、assignment 和 investigation queues。
- **M5:** Privacy-safe incident status、severity、category、action-required flag、verification 和 resolution timestamps。

## 不属于你的工作 | Out of Scope

- 不重新计算旧的 stored M2 assessment。
- 不公开 incident evidence 或 private investigation notes。
- 不把 synthetic demo records 描述为真实事故。
