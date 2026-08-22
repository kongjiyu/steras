# M1 队友任务说明

**M1 User and Event Management - Individual Handoff**

## 你的负责范围 | Your Ownership

你负责 Organizer 的身份与活动申请 lifecycle。你的工作重点不是风险评分、authority decision 或 incident investigation。

**Owned areas:** Authentication、Organizer Pages、Event Application、Document Upload、Version Submission、Public Calendar。

## 当前进度 | Current Progress

目前已经实现：

- Organizer registration/login 和 **role-based access**
- Organizer dashboard
- New/Edit Event application form
- Verified venue selector 与 custom venue input
- Event risk-profile input
- Draft saving 和 document upload
- Immutable submission 和 withdrawal
- My Events、Event Detail 和 real-time status
- Public Calendar 和 sanitised Public Event Detail
- `submitEvent`、`withdrawEvent` Cloud Functions
- 基本 Firestore Rules 与 Storage Rules

目前主要缺口 - **Main Gaps:**

- 完整 application lifecycle 的 **end-to-end UAT**
- Revision Requested 后 edit/resubmit 的验证
- M3 notification presentation
- M4 incident navigation
- Cross-organiser permission browser tests
- 所有页面的 loading、empty、error、permission 和 mobile states

## 接下来目标 | Immediate Goal

完成并验证 Organizer 的完整 **application lifecycle**，不要重新开发已经存在的页面。

最终应能演示：

> Register -> Create Draft -> Upload Evidence -> Submit -> View Assessment/Decision -> Receive Revision -> Edit New Version -> Resubmit

## 工作包 | Work Package

1. 同步 `NewEvent.tsx`、`EventDetails`、`EventRiskProfile` 和 `submitEvent.ts` validation。
2. 验证 draft saving、version-scoped uploads 和 immutable submission。
3. 验证 Revision Requested 后只编辑新的 version。
4. 验证 Draft/Pending 状态下允许的 withdrawal behavior。
5. 补齐 loading、empty、error、permission、mobile 和 keyboard states。
6. 建立 Organizer notification presentation，读取 M3 提供的 notification records。
7. M4 routes 完成后加入 incident navigation。
8. 验证 `public_events` 不包含 PII、private evidence、risk details 或 incidents。
9. 添加 complete golden-path 和 forbidden cross-user browser tests。

## 验收条件 | Acceptance Criteria

- Organizer 可以完成 register、draft、upload、submit、revision 和 resubmit。
- Submitted version 无法直接编辑或覆盖。
- 另一位 Organizer 无法读取申请或 evidence。
- Status 与 M2/M3 outputs 可以 real-time update。
- 只有 Approved 的 sanitised events 会出现在 public pages。
- M1 tests、Rules tests、typecheck、lint 和 build 全部通过。

## 需要其他 Module 提供 | Required Inputs

- **M2:** Assessment status、official risk、AI advisory status、resource recommendation。
- **M3:** Current decision、rationale、publication state、notifications。
- **M4:** Organizer-visible incident status 和 resolution history。

## 你需要提供给其他 Module | Outputs

- **M2:** Immutable `EventVersion`、venue、attendance、schedule、event risk profile 和 evidence paths。
- **M3:** Application/version records、organizer ownership 和 required authorities。
- **M4:** Stable event ID、version ID、organizer ID 和 venue ID。
- **M5:** Privacy-safe event type、date、status、venue 和 version fields。

## 不属于你的工作 | Out of Scope

- 不修改 M2 HIRARC scoring。
- 不实现 authority approval aggregation。
- 不决定 incident assessment eligibility。
- 不使用 analytics output 改变 application status。
