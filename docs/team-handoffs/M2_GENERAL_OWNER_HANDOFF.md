# M2 负责人兼 General Integrator 任务说明

**M2 Smart Risk Assessment and General Integration - Individual Handoff**

## 你的负责范围 | Your Ownership

你负责 deterministic risk assessment、advisory AI、resource recommendation，以及整个应用的 General integration。

**Owned areas:** HIRARC Engine、Context Evidence、MiniMax Advisory、Resource Planning、M2 Pages、Shared Integration、Release Coordination。

## 当前进度 | Current Progress

目前已经实现：

- Eight-domain **all-hazards assessment**
- DOSH HIRARC likelihood x severity
- Highest residual hazard official result
- Assessment readiness、compliance 和 evidence confidence
- Verified-control handling
- Weather、calendar、venue 和 comparable-history context
- Normalized historical incident/medical rates
- MiniMax advisory-only analysis 和 fallback
- Prototype resource baseline 与 planning ranges
- `/authority/risk` 和 `/authority/resources`
- Organizer/Authority reusable M2 components
- Emulator-only synthetic demo dataset
- Engine tests、Rules coverage 和 live external-service verification
- General routing、shared layouts、navigation 和 module ownership docs

目前主要缺口 - **Main Gaps:**

- M3 verified-control reviewer provenance
- M3 compliance/readiness decision integration
- M4 real incidents 和 completed-event outcomes
- M5 完整使用 readiness/compliance/confidence/schema fields
- PDRM/BOMBA/KKM 验证 resource assumptions
- Final end-to-end integration 和 coordinated release

## 接下来目标 | Immediate Goal

稳定现有 **all-hazards v2 contract** 并支持其他 module integration。除非 PRD 正式改变，否则不再进行新的 scoring redesign。

## 工作包 | Work Package

1. 维护 deterministic HIRARC、readiness、compliance、confidence 和 verified controls。
2. 保持 MiniMax 为 **advisory-only**，确保 timeout/invalid/unavailable 不改变 official result。
3. 维护 context provenance、normalized history retrieval 和 synthetic-data labelling。
4. 将 resource recommendations 保持为 prototype planning ranges，而不是 statutory minimums。
5. 给 M1/M3/M4/M5 提供 fixtures、typed contracts 和 sample records。
6. Review 其他 module 对 `shared/types.ts` 的修改，避免 contract drift。
7. 负责 General routing、shared visual consistency 和 cross-module navigation。
8. 处理 integration conflicts，但不静默修改其他 module 的 business rules。
9. 执行 full quality gates、emulator UAT 和 release coordination。

## 验收条件 | Acceptance Criteria

- 相同 immutable input 和 schema version 产生相同 official result。
- Official result、readiness 和 compliance 可以解释并追踪 evidence。
- AI failure 不会改变或阻止 deterministic assessment。
- Synthetic history 明确标记，不能被当作 real accuracy evidence。
- Resource output 保存 baseline、range、assumptions、authority 和 provenance。
- `npm run check`、Rules tests、external-service verification 和 emulator submission 通过。

## 需要其他 Module 提供 | Required Inputs

- **M1:** Immutable event version、venue、attendance、schedule、risk profile 和 evidence paths。
- **M3:** Verified-control reviewer/evidence provenance 和 human decision gates。
- **M4:** Verified eligible incidents、completed outcomes 和 after-action findings。
- **M5:** Analytics integration feedback，不得反向改变 scoring。

## 你需要提供给其他 Module | Outputs

- **M1:** Organizer-safe assessment/resource presentation records。
- **M3:** Official residual hazards、readiness、compliance、confidence、AI advisory 和 resource ranges。
- **M4:** Historical retrieval eligibility contract。
- **M5:** Versioned risk/resource/provenance fields 和 synthetic flags。

## General Integration 责任

- 维护 `App.tsx` routing 和 `docs/GENERAL.md` ownership。
- 维护 truly shared layout/UI primitives。
- 确认每个 page 只有一个 owner。
- 协调 shared type changes 和 module handoffs。
- 执行 final end-to-end walkthrough 和 deployment checks。

## 不属于你的工作 | Out of Scope

- 不替 M3 做最终 human decision。
- 不把 unverified 或 assessment-ineligible incident reports 加入 risk score。
- 不将 synthetic dataset 当作模型准确率证明。
- 不在没有 authority validation 时声称 resource ratios 是官方标准。
