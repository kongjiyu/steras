# M5 队友任务说明

**M5 Analytics and Reporting - Individual Handoff**

## 你的负责范围 | Your Ownership

你负责 privacy-safe、auditable、schema-aware 的 analytics 和 export。Analytics 只能观察 records，不能改变任何 business decision。

**Owned areas:** Reports Page、Metric Definitions、Filters、Charts、Aggregation、CSV/PDF Export、Privacy Tests。

## 当前进度 | Current Progress

目前已经实现：

- `/admin/analytics`（`/authority/reports` 保留为 compatibility redirect）
- `/dashboard-preview?view=reports` design-review preview
- Authority-scope query
- Date range filter
- Five report modes with event-type scope
- Monthly applications/approvals
- Official-risk distribution
- Assessment-quality signals
- Review outcomes and operations summaries
- Explicit M4 unavailable state
- Monthly average official score
- AI-vs-deterministic agreement
- AI fallback rate
- Average turnaround summary
- CSV export
- Basic spreadsheet-formula neutralisation
- Analytics helper unit tests
- Admin-only bounded `getAnalyticsPortfolio` Firebase callable backend
- Privacy-safe shared analytics response contract and input validation
- Synthetic-data exclusion by default
- Backend filters for date、event type、venue、risk、status、authority 和 schema version
- Live resource、override、re-application、incident 和 control aggregates
- Backend tests for authorization、PII exclusion、filter validation 和 synthetic fixtures

目前主要缺口 - **Main Gaps:**

- Expose venue、risk、status、authority、synthetic 和 schema filters in the report-builder UI
- Readiness、compliance 和 confidence metrics
- Full M4 incident triage、verification 和 resolution analytics after Module 4 supplies production fields
- Server-generated snapshots only when production volume exceeds the bounded callable model
- 更完整的 PII/export tests

## 接下来目标 | Immediate Goal

把现有 **analytics foundation** 扩展成 PRD-complete、auditable 和 privacy-safe 的 reporting module，不要重新建立一个新的 reports page。

## 工作包 | Work Package

1. 为每个 metric 记录 formula、source fields、denominator、exclusions、unavailable rule 和 schema behavior。
2. 添加 readiness、compliance、confidence 和 dominant-hazard views。
3. 添加 resource baseline/range、authority override 和 override-rate trends。
4. 添加 decision outcome、review duration 和 re-application metrics。
5. 添加 AI success/fallback/missing coverage。
6. AI agreement 只作为 monitoring metric，不能改变 official result。
7. M4 未提供 data 时显示 **Data Not Available**，不可显示为零。
8. 默认排除 synthetic records，并提供 explicit demo-data filter。
9. 添加 date、event type、venue、risk、status、authority scope 和 schema-version filters。
10. 扩展 CSV export，排除 PII/private fields 并测试 formula injection。
11. 数据增加时改用 bounded queries 或 server-generated `analyticsSnapshots`。

## 验收条件 | Acceptance Criteria

- 每个 PRD metric 正确显示或说明 unavailable reason。
- Insufficient data/low confidence 不会被统计为 Low risk。
- Analytics 根据 signed-in authority scope 过滤。
- 不同 schema/formula versions 不会混在一起误导用户。
- Synthetic records 默认不进入 operational KPIs。
- CSV/PDF export 不包含 organizer PII、evidence paths、incident descriptions 或 private investigation notes。
- Metric results 可重现并可追踪 source cutoff。

## 需要其他 Module 提供 | Required Inputs

- **M1:** Event type、venue、dates、versions、status 和 timestamps。
- **M2:** Residual matrix/band、dominant hazard、readiness、compliance、confidence、AI status、resource ranges 和 schema versions。
- **M3:** Decisions、review stages、timestamps、authority type、overrides 和 publication state。
- **M4:** Privacy-safe incident status、action-required flag、severity、category、verification 和 resolution timestamps。

## 你需要提供给其他 Module | Outputs

- Read-only metrics、filters 和 privacy-safe exports。
- Documented metric definitions 和 unavailable-data rules。
- Analytics 不提供任何 approval/risk/status mutation API。

## 不属于你的工作 | Out of Scope

- 不修改 M2 assessment。
- 不修改 M3 decision。
- 不决定 incident eligibility。
- 不以 AI agreement 作为 approval condition。
