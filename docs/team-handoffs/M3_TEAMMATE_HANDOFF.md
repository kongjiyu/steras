# M3 队友任务说明

**M3 Authority Approval and Notification - Individual Handoff**

## 你的负责范围 | Your Ownership

你负责人类 authority review、multi-agency decision、resource override、publication 和 notifications。

**Owned areas:** Authority Dashboard、Review Queue、Authority Event Review、Decisions、Overrides、Audit、Notifications、Publication。

## 当前进度 | Current Progress

目前已经实现：

- Authority dashboard
- Assigned application review queue
- Authority event review page
- Supporting evidence download
- Authority-scoped decision Function
- Versioned decision history
- Multi-authority aggregation
- Resource override 与 provenance
- Audit writes
- Same-version unanimous approval 后发布 sanitised `public_events`

目前主要缺口 - **Main Gaps:**

- Durable `notifications/{notificationId}`
- Verified-control workflow
- M2 `complianceStatus` approval gate
- Provisional/insufficient-data reviewer rationale
- Standalone audit UX
- AI-assisted rejection/revision wording
- 所有 decision branches 的 browser/emulator UAT

## 接下来目标 | Immediate Goal

完成真正的 **human authority review workflow**，确保 final decision 永远由 authorised human reviewer 负责。

## 工作包 | Work Package

1. 阻止 `complianceStatus: blocked` 的 application 被 Approved。
2. 当 readiness 为 provisional/insufficient data 时要求 reviewer rationale。
3. 实现 server-mediated control verification。
4. Control verification 必须保存 control ID、authority type、reviewer UID、evidence path、timestamp 和 version。
5. 保留每个 application version 的 current decision 和 complete history。
6. 维护 rejection precedence、revision precedence 和 unanimous approval。
7. 实现 idempotent `notifications/{notificationId}`。
8. Notification 包含 recipient、event/version、type、title、privacy-safe message、created/read timestamps 和 source action ID。
9. 提供 Organizer notification Rules 与 M1 display contract。
10. 添加 concurrency、resubmission、permission denial 和 publication sanitisation tests。

## 验收条件 | Acceptance Criteria

- Authority 只能读取和操作 assigned applications。
- Blocked compliance 无法 Approved。
- Provisional/insufficient data decision 保存 explicit rationale。
- 只有所有 required authorities 对同一个 version Approved 才公开活动。
- Rejected precedence 正确；Event Application 没有 AmendmentRequested 状态，控制文件另有独立的 Request resubmission 流程。
- Decisions、overrides、control verification 和 notifications 全部可审计。
- 新 version 不删除旧 decision history。

## 需要其他 Module 提供 | Required Inputs

- **M1:** Event/version records、evidence paths、organizer ownership 和 required authorities。
- **M2:** Official residual hazards、readiness、compliance、confidence、AI advisory 和 resource ranges。
- **M4:** Incident triage、assignment、investigation queues 和 escalation links。

## 你需要提供给其他 Module | Outputs

- **M1:** Aggregate status、decision rationale、revision/rejection details、notifications 和 publication state。
- **M4:** Authority identity/scope、assignment 和 escalation decision links。
- **M5:** Decision outcomes、review stages、timestamps、authority type、overrides 和 publication state。

## 不属于你的工作 | Out of Scope

- 不修改 M2 official score。
- 不让 MiniMax 自动批准或拒绝。
- 不允许 unassigned authority 查看申请。
- Push notification failure 不可以 rollback decision。
