# STERAS Full E2E Submission Guide

这是一份可以直接照着执行的 production rehearsal。它从 Organizer 建立申请开始，经过 M1、M2、M3、M4，最后在 M5 验证报表。

> 测试网址：<https://linkos-496505.web.app>
>
> 本指南使用的是合成示范资料，不是真实政府批准、执照或现场证明。账号密码使用团队另外保管的共用 demo password；密码不要写进 Git repository。

## 0. 开始前先准备

### 0.1 下载或打开这些文件

| 用途 | 文件 |
|---|---|
| M1 combined Core + T01 application | [`output/pdf/m1-presentation-test-case/STERAS_DEMO_T01_Completed_Combined_Application.pdf`](../../output/pdf/m1-presentation-test-case/STERAS_DEMO_T01_Completed_Combined_Application.pdf) |
| M1 supporting evidence，以及 M3 Stage 1 technical rehearsal | [`output/m1-presentation-test-case/03_Core_Supporting_Evidence_Pack.pdf`](../../output/m1-presentation-test-case/03_Core_Supporting_Evidence_Pack.pdf) |
| 对照 Core form | [`output/m1-presentation-test-case/01_Filled_Core_Event_Application_T01.docx`](../../output/m1-presentation-test-case/01_Filled_Core_Event_Application_T01.docx) |
| 对照 T01 form | [`output/m1-presentation-test-case/02_Filled_T01_Indoor_Performance_Template.docx`](../../output/m1-presentation-test-case/02_Filled_T01_Indoor_Performance_Template.docx) |
| PDRM Stage 2 photo | [`assets/e2e-2026-09-30/stage2-pdrm-crowd-entry.jpg`](assets/e2e-2026-09-30/stage2-pdrm-crowd-entry.jpg) |
| BOMBA Stage 2 photo | [`assets/e2e-2026-09-30/stage2-bomba-fire-egress.jpg`](assets/e2e-2026-09-30/stage2-bomba-fire-egress.jpg) |
| KKM Stage 2 photo | [`assets/e2e-2026-09-30/stage2-kkm-medical-point.jpg`](assets/e2e-2026-09-30/stage2-kkm-medical-point.jpg) |
| DBKL Stage 2 photo | [`assets/e2e-2026-09-30/stage2-dbkl-venue-setup.jpg`](assets/e2e-2026-09-30/stage2-dbkl-venue-setup.jpg) |
| M4 crowd incident photo | [`assets/e2e-2026-09-30/m4-crowd-arrival-surge.jpg`](assets/e2e-2026-09-30/m4-crowd-arrival-surge.jpg) |

四张 Stage 2 照片均为 AI 生成的 synthetic rehearsal evidence，不含真实 officer identity、政府 logo 或 approval document，并且都小于系统的 700 KB 限制。它们只能用于技术测试和 presentation。正式申请必须改用对应 control 的真实现场照片。

### 0.2 Demo 账号

| 角色 | Email |
|---|---|
| Organizer | `organizer1@steras.test` |
| Admin | `steras-admin@steras.test` |
| PDRM | `pdrm.showcase@steras.test` |
| BOMBA | `bomba.showcase@steras.test` |
| KKM | `kkm.showcase@steras.test` |
| DBKL | `dbkl.showcase@steras.test` |
| Public viewer，可选 | `public1@steras.test` |

如果 Admin assignment checklist 显示的 officer 不是上表账号，以 checklist 实际选中的 officer 为准。记录所选 email，后面用该账号登录。

### 0.3 固定活动时间

本测试固定使用 **2026 年 9 月 30 日**：

```text
Start: 2026-09-30 09:00
End:   2026-09-30 18:00
```

M1–M3 可以在 9 月 30 日之前完成。M4 必须在 **2026-09-30 10:30 之后**执行；系统只允许活动已经开始后提交 incident。活动结束后七天内仍可以补报，因此这套 M4 数据最迟应在 **2026-10-07 18:00** 前提交。

### 0.4 测试记录

执行时把这些结果填下来：

```text
Event name:
Event ID / URL:
Current version:
Assessment status:
Overall risk:
Current resource revision:
Selected PDRM officer:
Selected BOMBA officer:
Selected KKM officer:
Selected DBKL officer:
Incident reference:
Final application status:
```

---

## 1. M1 — Organizer 建立并提交申请

### 1.1 登录并选择 scenario

1. 打开 <https://linkos-496505.web.app/login>。
2. 使用 `organizer1@steras.test` 登录。
3. 点击顶部 **New Event**。
4. 在 **Template recommendation** 页面选择：
   - Event category：**Entertainment and Performance Event**
   - Venue setting：**Indoor**
5. 确认系统推荐：
   - **Core Event Application Template**
   - **T01 - Entertainment and Performance Event - Indoor**
6. 分别点击 template preview，确认 single-page 和 multiple-page preview 能打开。
7. 点击开始申请的按钮进入 application form。

预期结果：页面顶部显示已选择两个 templates，包含 Core 和 T01。

### 1.2 上传 combined PDF 并 auto-fill

1. 选择 **Upload one combined file**。Core、scenario 和 combined application 三种 slot 都接受 PDF 或 DOCX；本次 rehearsal 使用 combined PDF。
2. 上传：

```text
output/pdf/m1-presentation-test-case/STERAS_DEMO_T01_Completed_Combined_Application.pdf
```

3. 点击 **Extract and auto-fill**。
4. 等待 extraction 完成，不要在处理中重复点击。

预期结果：

- 显示 **100% extracted**；
- 系统识别到 `STERAS-CORE` 和 `STERAS-T01-ENT-IN-v2.0`；
- `A06A / VENUE_NAME` 被识别为 `Kuala Lumpur Convention Centre`；
- Event、Organizer、Venue、Emergency plan，以及 H01–H18 全部 all-hazards fields 被填入。

如果 extraction 失败，不要手动提交空白 form；先确认上传的是新版 18-page combined PDF，而不是其中一个未合并的文件。旧版 combined PDF 没有完整 `A06A / VENUE_NAME` 和 H01–H18 fields，即使重新 extraction 也不能完整 auto-fill；请重新下载本指南链接的新版 PDF 再上传。

### 1.3 Review auto-filled fields

逐个 section 检查，并改成以下值：

| Section | Field | 要填的值 |
|---|---|---|
| Event | Event name | `Malaysia Tourism Storytelling Showcase 2026 - Live Rehearsal` |
| Event | Event type | `Concert / Music`；如果 UI 只有 `Concert`，选 `Concert` |
| Venue | Venue name after extraction | `Kuala Lumpur Convention Centre`；这是 PDF 提取值，尚未完成 registry verification |
| Venue | Verified venue registry | `Kuala Lumpur Convention Centre` |
| Venue | Venue name after registry binding | registry 自动确认并锁定为 `Kuala Lumpur Convention Centre` |
| Venue | Venue address | registry 自动提供 canonical address |
| Venue | Venue capacity | registry 自动提供 `8000` |
| Venue | Latitude | registry 自动提供约 `3.1530` |
| Venue | Longitude | registry 自动提供约 `101.7130` |
| Event | Expected attendance | `600` |
| Event | Environment | `Indoor` |
| Event | Coverage | `Covered` |
| Event | Seating | `Seated` |
| Event | Start date and time | `2026-09-30 09:00` |
| Event | End date and time | `2026-09-30 18:00` |
| Event | Description | 复制下方 Description |
| Organizer | Organizer name | `Aina Rahman` |
| Organizer | Email | `aina.rahman@example.com` |
| Organizer | Phone | `+60 12-345 6789` |

Description：

```text
A seated indoor showcase combining Malaysian cultural storytelling and acoustic music in a controlled programme for invited guests and members of the public.
```

Emergency-plan summary 如果没有被 extraction 填入，就复制：

```text
The event team will operate controlled entry and exit points, maintain clear emergency egress routes, brief security and ushers before opening, provide an on-site first-aid point, and coordinate evacuation through the venue command post. Any crowd, medical, fire, weather or transport disruption will be escalated to the relevant authority and recorded by the event manager.
```

重要：PDF 成功提取 Venue name 不等于完成 verified venue binding。必须另外在 **Verified venue registry** 选择 Kuala Lumpur Convention Centre，让系统以 registry 的 canonical name、address、capacity 和 coordinates 覆盖并锁定对应字段。不要只保留提取出的 Venue name，也不要选择 Custom / unverified venue，否则 M2 会视为资料不足。

### 1.4 填 all-hazards profile

新版 Core template 已填写 H01–H18，成功 extraction 后这些值应该已经自动出现。逐项对照 PDF；只有发现提取遗漏时才手动补填。每个 boolean 都必须明确 checked 或 unchecked。

勾选：

- Crowd management plan declared
- Traffic management plan declared
- Severe weather plan declared
- Medical plan declared
- Evacuation plan tested

不要勾选：

- International attendees expected
- Alcohol served
- Food served
- Free drinking water planned
- Ticketed entry or attendee registration
- Overnight accommodation involved
- Pyrotechnics or special effects
- Temporary stages or structures
- Rivalry or crowd tension expected
- Authority coordination confirmed

Numeric values：

| Field | Value |
|---|---:|
| Vulnerable attendees estimate | `10` |
| Standing attendees estimate | `0` |
| Nearest hospital travel time | `10` |

### 1.5 上传并 map M1 supporting evidence

先在 **DOC-A01 — Venue Permission Letter** 上传：

```text
output/m1-presentation-test-case/03_Core_Supporting_Evidence_Pack.pdf
```

然后在其余 Core requirements 选择同一个 already-uploaded evidence：

- DOC-A02 — Site or Layout Plan
- DOC-A03 — Location Map and Current Photographs
- DOC-B01 — Organiser Identification
- DOC-B02 — Organisation Registration Document
- DOC-C01 — Event Programme or Schedule
- DOC-C02 — Supplier and Contractor List
- DOC-D01 — Safety and Operational Plan
- DOC-D02 — Emergency and Evacuation Plan

说明：这份 consolidated PDF 只用于完整技术 rehearsal。真实申请应该上传各自对应、可验证的文件。

### 1.6 将九项 T01 conditional evidence 标记为 Not applicable

每一项选择 **Not applicable**，分别输入：

| Requirement | 要填的 reason |
|---|---|
| T01-DOC-01 | `No foreign performers are involved in this event.` |
| T01-DOC-02 | `No pyrotechnics, flame, smoke, lasers or special effects are used.` |
| T01-DOC-03 | `The seated 600-person event is not classified as large-scale or high-crowd, and no extra authority evidence has been requested.` |
| T01-DOC-04 | `No temporary stage, platform, partition, truss or booth is installed.` |
| T01-DOC-05 | `No food or beverage vendor operates inside the performance venue.` |
| T01-DOC-06 | `No alcohol is sold, supplied or served at the event.` |
| T01-DOC-07 | `No drone operation is planned inside or above the venue.` |
| T01-DOC-08 | `The event has not been classified as high-risk or large-scale.` |
| T01-DOC-09 | `Admission is free and no ticketing or attendee registration is used.` |

预期结果：evidence counter 显示 **18 / 18 complete**。

### 1.7 保存并提交

1. 再检查一次 Start time 是 `2026-09-30 09:00`，而且提交时它仍在未来。
2. 点击 **Save draft**。
3. 刷新一次页面，确认资料和 evidence mapping 仍存在。
4. 点击 **Submit application**。
5. 等待成功信息，不要重复提交。
6. 打开 **My Events**，进入刚建立的 event。
7. 把浏览器 URL 内的 Event ID 记录到 0.4。

预期结果：

- Event status 是 **Pending**；
- current version 是 **v1**；
- submitted version 和文件成为 immutable record；
- M2 assessment 开始 processing。

---

## 2. M2 — MiniMax proposal、risk assessment 和 resources

### 2.1 等待 automated assessment

1. 留在 Organizer event detail，或每 20–30 秒刷新一次。
2. 最多等约 2 分钟。
3. 查看 Risk assessment 和 Resource recommendation。

正常 happy path 预期：

- assessment 从 `processing` 变成 `provisional_ready`；
- MiniMax proposal 有精确八个 categories；
- 页面显示 provisional overall/category result；
- resource recommendation 有七项：Police、Security、Medical teams、Ambulances、Fire officers、Toilets、Waste bins；
- resource 文案说明 ratios 是 `internal prototype/unverified`。

如果在 OpenWeather forecast horizon 之前执行，weather context 可以显示 `outside horizon` / unavailable warning；这是预期行为。系统不得为 9 月 30 日伪造 temperature、humidity、wind 或 precipitation 数值，并会使用明确的 conservative missing-weather rule。

记录：

```text
Assessment status:
Overall risk:
Police baseline/range:
Security baseline/range:
Medical team baseline/range:
Ambulance baseline/range:
Fire officer baseline/range:
Toilet baseline/range:
Waste-bin baseline/range:
```

如果状态是 `manual_review_required`：

- 不要伪造或手填 AI result；
- Admin 登录后在 **Manual Assessment Queue** 完成八类人工 assessment；
- 这是 recovery path，不是本 happy-path rehearsal 的失败。

---

## 3. M3 — Admin initial review 和 officer assignment

### 3.1 Admin initial review

1. Sign out。
2. 使用 `steras-admin@steras.test` 登录。
3. 打开 **Applications**。
4. 找到 `Malaysia Tourism Storytelling Showcase 2026 - Live Rehearsal`。
5. 打开 application。
6. 检查 submitted version、18/18 evidence、M2 provisional result 和 resources。
7. 在右侧 **Admin decision** 点击 **Approve application**。
8. Approval rationale 输入：

```text
The submitted Core and T01 application, venue binding, supporting evidence and provisional M2 outputs are complete enough to proceed to coordinated authority review.
```

9. 点击 **Confirm approval**。

预期结果：event 进入 **UnderReview**，review stage 进入 initial/authority assignment 流程。

### 3.2 指派四个 authority officers

1. 点击 **Open assignment checklist**。
2. 确认 required authorities 是 PDRM、BOMBA、KKM、DBKL。
3. 每个 authority 选择一个 officer。优先选择：
   - PDRM：`pdrm.showcase@steras.test`
   - BOMBA：`bomba.showcase@steras.test`
   - KKM：`kkm.showcase@steras.test`
   - DBKL：`dbkl.showcase@steras.test`
4. 把实际选择的四个账号写入 0.4。
5. 点击 **Assign officers**。

预期结果：四项均显示 **Assigned**，event review stage 是 `authority`。

---

## 4. M2 officialisation — 四个 officers 完成 category review

以下步骤要对 PDRM、BOMBA、KKM、DBKL 各做一次。

### 4.1 每个 officer 都执行

1. Sign out。
2. 使用当前 authority 的 assigned account 登录。
3. 打开 **Applications**，选择 rehearsal event。
4. 找到 **Your category score review**。
5. 八个 category 全部保持 **Confirm AI score**。
6. **Review rationale** 输入：

```text
I reviewed the submitted application, eligible evidence, venue context, AI proposal, provisional calculation and deterministic safety floors. I confirm all eight category scores for this rehearsal.
```

7. 点击 **Submit score review**。
8. 确认出现 **Submitted · revision allowed** 或成功 toast。
9. Sign out，然后换下一个 authority 账号重复。

不要在这个 happy path 改任何 likelihood/severity，否则不同 officers 的分数会产生 conflict，需要 Admin resolution。

如果页面同时显示 **Authority score confirmation / override**，这不是本流程需要操作的 category-review form；不要在 happy path 修改它。也不要使用 **Adjust resources**。

最后一个 required authority 提交后，预期结果：

- assessment 自动变为 `official_ready`；
- 页面标题变成 **Official AI-assisted assessment**；
- official resource revision 被建立；
- provisional records 仍保留，不会被覆盖。

---

## 5. M3 — Officers 提交 application proposal

还是对四个 assigned officers 各做一次。

1. 使用 officer account 登录并打开 rehearsal event。
2. 确认页面已经显示 **Official AI-assisted assessment** 和 official resources。
3. 在右侧 **Decision rationale** 输入：

```text
I reviewed the current application version, supporting evidence, official risk assessment and resource planning ranges. The submission can proceed subject to the published event controls.
```

4. 勾选确认已检查 application、evidence、assessment 和 resources 的 checkbox。
5. 点击 **Propose approval**。
6. 确认出现 **Approval proposal recorded**。
7. Sign out，换下一个 officer 重复。

预期结果：四个 assignments 都变成 completed，并且 aggregate recommendation 是 **Approved**。

### 5.1 Admin second review

1. 使用 Admin 登录。
2. 打开 application 的 **Open officer assignment** 页面。
3. 找到 **Second review**。
4. Admin final decision 选择 **Approved**。
5. Admin note 输入：

```text
All required authorities completed their current-version review and recommended approval. The application is approved for event-control preparation.
```

6. 点击 **Record final decision (Approved)**。

预期结果：

- Event status 变成 **Approved**；
- officer proposals 没有直接发布活动；
- final decision 有 Admin audit provenance。

---

## 6. M3 — 建立 control list、上传 Stage 1 和 Stage 2

### 6.1 Admin generate 和 commit control list

1. Admin 打开 application。
2. 点击 **Open event control list**。
3. 点击 **Generate proposal**。
4. 等待 Source 显示 **MiniMax proposal** 或明确的 deterministic fallback。
5. 检查每个 required authority 恰好有一个 control。
6. 如果 **Commit changes** 显示 disabled 的 **No changes**，在第一个 control name 最后加一个句号 `.`，再删掉该句号；若仍 disabled，就保留一个不改变语义的小编辑，例如把 `verification` 改成 `verification check`。
7. 点击 **Commit changes**。

预期结果：页面显示 control list **published**，Organizer 可以看到对应 Stage 1 和 Stage 2 requirements。

### 6.2 Organizer 上传所有 Stage 1 files

1. Sign out，使用 Organizer 登录。
2. 打开 **My Events → rehearsal event → Event controls**。
3. 对每一个 Stage 1 row 点击 **Upload**。
4. 每一项都上传：

```text
output/m1-presentation-test-case/03_Core_Supporting_Evidence_Pack.pdf
```

5. 确认每一项变成 **Awaiting officer verification**。

这份文件小于 700 KB，技术上符合 Stage 1 upload 限制。它只是 consolidated rehearsal evidence；正式流程必须上传与 row label 对应的真实 receipt、application、floor plan、licence 或 insurance。

### 6.3 Officers 验证自己 authority 的 Stage 1 rows

每个 assigned officer：

1. 登录并打开 rehearsal event。
2. 滚动到 **Event controls / Stage 1 verification**。
3. 对属于自己 authority 的每一个 pending document：
   - Verification rationale 输入：

```text
The uploaded rehearsal document is readable, linked to the current event version and sufficient for this control verification exercise.
```

   - Evidence path 留空；
   - 点击 **Verify**。
4. 重复直到该 authority 的所有 rows 都显示 verified。

### 6.4 Organizer 上传 Stage 2 images

1. 使用 Organizer 登录。
2. 回到 **Event controls**。
3. 对每个 authority 的 Stage 2 row 点击 **Upload**。
4. 按以下对应关系上传，不要四项共用同一张图：

| Authority | 上传文件 |
|---|---|
| PDRM | `docs/presentation/assets/e2e-2026-09-30/stage2-pdrm-crowd-entry.jpg` |
| BOMBA | `docs/presentation/assets/e2e-2026-09-30/stage2-bomba-fire-egress.jpg` |
| KKM | `docs/presentation/assets/e2e-2026-09-30/stage2-kkm-medical-point.jpg` |
| DBKL | `docs/presentation/assets/e2e-2026-09-30/stage2-dbkl-venue-setup.jpg` |

5. 确认每项显示 **Pending admin review**。

### 6.5 Admin publish Stage 2

1. 使用 Admin 登录。
2. 打开 application。
3. 点击 **Review Stage 2 images**。
4. 打开每张图片检查。
5. 对每一项点击 **Publish**。

预期结果：所有 Stage 2 rows 显示 **Published**，public-safe projection 可读取，内部 Storage path 不会公开。

---

## 7. M4 — 提交、调查并关闭 incident

### 7.1 先检查 event window

只有活动已经开始，且尚未结束或结束不超过七天，event 才会出现在 incident form。

1. 确认当前时间已经超过 `2026-09-30 10:30`。
2. 如果还没到，先完成 M1–M3，等到 9 月 30 日再执行本节。

### 7.2 Organizer 提交 incident

1. 使用 Organizer 登录。
2. 打开 sidebar 的 **Incidents**，URL 应是 `/organizer/incidents`。
3. 在 **Submit an incident** 填：

| Field | 要填的值 |
|---|---|
| Event | `Malaysia Tourism Storytelling Showcase 2026 - Live Rehearsal` |
| Category | `crowd` |
| Occurrence date and time | `2026-09-30 10:30`；必须在这个时间之后才提交 |
| Location | `Main entrance holding area, Kuala Lumpur Convention Centre` |
| Description | 复制下方文字 |
| Supporting evidence | `docs/presentation/assets/e2e-2026-09-30/m4-crowd-arrival-surge.jpg` |

Description：

```text
An unexpected arrival surge caused crowd density to increase beside the main entrance holding area. Ushers opened the secondary queue lane, paused entry briefly and requested additional security support. No injury was reported.
```

4. 点击 **Submit report**。
5. 记录 incident reference。

预期结果：

- incident 出现在 Incident queue；
- MiniMax 返回 severity、rationale 和 immediate-action indicator，或明确显示 unavailable/invalid 而不是伪造 result；
- history 有 initial submission。

### 7.3 Organizer 记录 completed response

在 **Organizer response**：

1. Team 保持 `Venue operations`。
2. Note 输入：

```text
Venue operations activated the secondary queue lane, deployed two additional ushers and paused entry until crowd density returned to a controlled level. Emergency access remained clear and no injury was reported.
```

3. 点击 **Record completed response**。

预期结果：incident status 进入 `awaiting_resolution`，并产生 append-only history entry。

### 7.4 Organizer final resolution

1. 留在或重新打开该 incident。
2. Final rationale 输入：

```text
The secondary queue lane remained active until the arrival peak ended. Additional ushers stayed at the entrance, crowd density returned to normal and no injury or further escalation occurred. The incident is closed with the revised entry arrangement retained for the remainder of the event.
```

3. 如果出现 manual severity，下拉选择 **Medium**。
4. 点击 **Final resolution and close**。

预期结果：status 是 **resolved**，final resolution 和完整 history 可见。

如果你另外要测试 authority referral，可以在 7.3 改为选择 recommended authority 并点击 **Request external assistance**。系统会自动指派当前 workload 最低的 active officer；必须由实际收到 incident notification 的 officer 登录 `/authority/incidents`，输入调查 finding 并点击 **Submit finding to organizer**，之后 Organizer 才执行 7.4。这个 referral 分支不是完成本 runbook 的必要条件。

---

## 8. M5 — 验证 analytics 和 export

1. 使用 Admin 登录。
2. 打开 **Analytics**，URL 是 `/admin/analytics`。
3. Analysis scope 选择 **Overall**。
4. From 和 To 先留空。
5. 依次选择并点击 **Generate report**：
   - Report 01 — Risk & incidents
   - Report 02 — Outcomes & rejection
   - Report 03 — Assessment quality
   - Report 04 — Resources & overrides
   - Report 05 — Control compliance
6. 在 Report 01 确认 incident count 包含刚建立的 incident。
7. 在 Report 03 确认 official risk assessment 被统计。
8. 在 Report 04 确认七项 resource baselines/ranges 可见。
9. 在 Report 05 确认 Stage 1/control verification 状态可见。
10. 点击 **Export CSV**，确认下载成功。
11. 点击 **Save as PDF**，在 browser print dialog 选择 Save as PDF；不需要真的打印。

预期结果：

- Source 显示 live Firestore，而不是 preview synthetic data；
- report 只使用 latest valid records；
- 页面不出现 Organizer contact、private evidence path、incident description 或 internal authority note；
- 没有资料的指标显示 **Data Not Available**，不会显示虚构的 `0`。

---

## 9. 最终 PASS checklist

全部勾选才算完成整套 E2E：

- [ ] M1 combined PDF extraction 达到 100%。
- [ ] `A06A / VENUE_NAME` 成功提取为 Kuala Lumpur Convention Centre。
- [ ] M1 verified venue 是 Kuala Lumpur Convention Centre，不是 custom venue。
- [ ] Registry binding 后的 canonical address、capacity 和 coordinates 已自动填入并锁定。
- [ ] M1 evidence 是 18 / 18 complete。
- [ ] Application 成功提交为 immutable v1，status 是 Pending。
- [ ] M2 有 MiniMax 八类 proposal，或明确进入 manual recovery；没有 fake fallback score。
- [ ] M2 provisional assessment 和七项 resource recommendation 都存在。
- [ ] Admin initial review 完成，四个 authorities 已 assigned。
- [ ] 四个 category reviews 完成，assessment 是 official_ready。
- [ ] Official resource revision 存在，provisional resource history 仍保留。
- [ ] 四个 officer application proposals 完成。
- [ ] Admin second review 将 application 设为 Approved。
- [ ] Control list 已 generate 并 commit。
- [ ] 所有 Stage 1 docs 已验证。
- [ ] 所有 Stage 2 images 已由 Admin publish。
- [ ] M4 incident 已 submitted、responded、resolved。
- [ ] M5 五种 report 可生成，CSV/PDF export 可启动。
- [ ] 各角色页面没有看到不该暴露的 internal rationale、identity 或 Storage path。

## 10. 常见卡点

### Venue 下拉只有 Custom / unverified venue

- 刷新页面并重新进入 New Event；
- 确认使用 production URL；
- 不要继续提交 custom venue；
- 请 Admin 到 **Venues** 确认 Kuala Lumpur Convention Centre 是 active 且 verified。

### Venue name 没有从 combined PDF 提取

- 确认上传的是本指南链接的新版 18-page combined PDF；
- 打开 PDF 并确认 Core form 内存在 `A06A / VENUE_NAME`；
- 如果使用的是之前下载的旧 PDF，请删除该 upload、重新下载新版 PDF、重新上传，再点击 **Extract and auto-fill**；
- 如果网页仍显示旧 extraction 行为，先强制刷新 production 页面再重试；
- extraction 成功后仍要另外选择 Verified venue registry，不能把提取值当成 registry verification。

### Submit application 按钮不能按

依次检查：

- Start time 是否仍在未来；
- combined extraction 是否完成；
- venue 是否从 registry 选择；
- all-hazards booleans 是否全部明确；
- 三个 percentage/minute 数值是否合法；
- evidence 是否 18 / 18 complete；
- emergency-plan summary 是否有内容。

### M2 一直 processing

- 等 2 分钟后刷新；
- 不要重复提交 application；
- 如果变成 `manual_review_required`，由 Admin 走 Manual Assessment Queue；
- 如果完全没有新状态，记录 Event ID 和浏览器错误再检查 Functions logs。

### Officer 看不到 application

- 回到 Admin assignment checklist，确认该 officer 是 current-version assigned officer；
- 确认 event status 是 UnderReview；
- 确认 officer 登录的是被选中的 email，而不是同 authority 的另一个账号。

### Official assessment 没有产生

- 检查每一个 required authority 都提交了 **Your category score review**；
- 检查是否有人选择 Override 导致 conflict；
- 有 conflict 时必须由 Admin 在 dashboard 的 score-conflict queue resolution 后才会 finalise。

### Control list 无法 commit

- Generate 后必须有每个 required authority 各一个 item；
- **Commit changes** 必须处于 enabled；
- 如果显示 **No changes**，按 6.1 做一次可见但不改变意思的小编辑再 commit。

### M4 Event 下拉没有 rehearsal event

- Event 必须已经 Approved；
- 当前时间必须已经到 Start time；
- End time不能早于 incident occurrence；
- occurrence time 不能晚于当前时间超过五分钟。

### Stage 1 / Stage 2 upload 被拒绝

- Stage 1：JPEG、PNG 或 PDF，最大 700 KB；
- Stage 2：只接受 JPEG 或 PNG，最大 700 KB；
- M4 evidence：JPEG、PNG、WebP 或 PDF，单个最大 10 MB。
