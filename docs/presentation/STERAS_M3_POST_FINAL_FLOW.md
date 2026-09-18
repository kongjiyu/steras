# STERAS M3 后批准流程演练指南

本指南按照 Module 3 activity flow，覆盖 Admin 的第二次审核、Event Control List、Stage 1 Authority verification、Organizer 重传、Stage 2 Admin publication 和基线恢复。产品界面保留英文按钮、状态和 route，方便在实际页面逐项对照。

生产中的 managed applications 只用于已授权登录后的工作流演示，不会写入 `public_events` 或 `public_event_controls`。Public publish/confirm/report 的完整公众流程请在 Firebase emulator 或 staging 的非生产 E2E fixture 执行。

## 准备好的申请

| Application ID | UI 状态 | 基线与重点 |
| --- | --- | --- |
| `presentation-putrajaya-community-run` | `Final Review` | 五个 current-version Authority assignments 已完成，等待 Admin final decision。内部 `reviewStage=second`，UI 仍使用 `Final Review`。 |
| `presentation-penang-heritage-weekend` | `Documentation Required` | Control list 已确认；没有 Stage 1 或 Stage 2 文件。 |
| `presentation-selangor-food-festival` | `Documentation Required` | Stage 1 文件已上传，等待对应 Authority verification。 |
| `presentation-johor-waterfront-fair` | `Documentation Required` | Stage 1 已验证，canonical Stage 2 文件等待 Admin publication。 |
| `presentation-craft-market` | `Documentation Required` | PDRM、BOMBA、KKM、DBKL、MOTAC 的 Stage 1 文件都在等待审核，适合验证 BOMBA queue。 |

这些申请使用正式 event identity、venue、organiser 和 workflow artifacts。fixture ownership marker 只保存在内部 metadata，普通 UI 不显示；生产 callable 会阻止它们建立公开 projection。

## 测试账号与入口

密码不写入本指南，也不由 seeder 生成或重置；使用团队受限渠道提供的现有登录凭据。

| 角色 | 账号 | 入口 |
| --- | --- | --- |
| Admin | `admin.showcase@steras.test` | `/admin/applications` |
| Organizer | `organizer1@steras.test` | `/organizer/events` |
| PDRM Authority | `pdrm.showcase@steras.test` | `/authority/applications` |
| BOMBA Authority | `bomba.showcase@steras.test` | `/authority/applications` |
| KKM Authority | `kkm.showcase@steras.test` | `/authority/applications` |
| DBKL Authority | `dbkl.showcase@steras.test` | `/authority/applications` |
| MOTAC Authority | `motac.showcase@steras.test` | `/authority/applications` |
| Public viewer（emulator/staging only） | `participant.showcase@steras.test` | `/events/<application-id>` |

## 演练步骤

1. **Admin final decision**：打开 `/admin/applications`，筛选 `All applications`，搜索 `presentation-putrajaya-community-run`。确认五个 Authority assignments 已完成，然后在 application details 记录 Admin final approval。
2. **确认 Control List**：final approval 成功后检查自动打开的 proposal modal；关闭后重新打开 `/admin/applications/presentation-putrajaya-community-run/controls`，确认 draft 会恢复。点击 `Confirm control list`，确认后所有 control cards 变为 read-only。
3. **Organizer 上传 Stage 1**：以 Organizer 打开 `/organizer/events/presentation-penang-heritage-weekend/controls`，为每个 authority control 上传所需 Stage 1 文件。Stage 2 只能在该 control 的所有 Stage 1 项目被验证后上传。
4. **Authority 审核 Stage 1**：以对应 Authority 打开 `/authority/events/presentation-penang-heritage-weekend`。可以查看所有 control 状态，但只能操作自己部门且被分配的 control。批准时 rationale 可留空；拒绝必须填写 10–1000 字原因。Admin 页面只显示进度，不替 Authority 作决定。
5. **拒绝与重传**：在 `presentation-selangor-food-festival` 选一项 Stage 1 文件，以对应 Authority 点击 Reject 并填写原因；Organizer 看到通知后上传新 revision。旧 revision 保留，Authority 再次验证新 revision 后 control 才回到 verified。
6. **BOMBA queue 验证**：以 `bomba.showcase@steras.test` 打开 `/authority/applications`，保留 `All` 或选择 `Documentation`，搜索 `presentation-craft-market`。应看到五部门资料状态，但只有 BOMBA 的 control 可以操作；检查待审数量与两个 canonical Stage 1 document IDs。
7. **Stage 2 与 Admin publication**：在 `presentation-johor-waterfront-fair` 检查 Stage 1 已验证、Stage 2 使用 `<controlId>-s2`。以 Admin 打开 `/admin/applications/<application-id>/stage2-review`，选择 `Publish`、`Reject` 或 `Unpublish`；Stage 2 没有 Authority decision。
8. **Public 流程（emulator/staging）**：在非生产 E2E fixture 以 Admin publish Stage 1/Stage 2 safe copy，再以 Public viewer 打开 `/events/<application-id>`，验证预览、下载、Confirm、Report 与 M4 notification。生产 managed applications 不执行这一步。
9. **刷新与审计**：重新载入 Admin、Organizer 和 Authority 页面，检查 status、proposal revision、Stage 1 revision history、notifications、audit log、canonical document IDs 仍一致。

## 验收条件

- `Final Review` 的 final decision 在 control list confirmation 之前记录。
- 每个 Authority 只能审核自己部门且分配给自己的 Stage 1 文件。
- Stage 1 reject 必须有原因；Organizer resubmit 会建立新 revision，不覆盖旧历史。
- 某个 control 的 Stage 1 全部通过后，才解锁该 control 的 Stage 2；其他部门未完成不会阻挡已完成 control。
- Stage 2 只由 Admin publish/reject/unpublish。
- 五个生产 managed applications 始终没有 `public_events` 或 `public_event_controls` projection。

## Guarded 基线恢复

所有写操作必须使用预期 production project、显式 confirmation token 和 `--only`，不能传任意 event ID。每次演练后先运行 verifier，再对变更的记录重新 apply baseline：

- `presentation-putrajaya-community-run`：`Final Review`，五个完成的 Authority decisions，无 control list。
- `presentation-penang-heritage-weekend`：`Documentation Required`，confirmed controls，无 Stage 1/Stage 2 文件。
- `presentation-selangor-food-festival`：`Documentation Required`，Stage 1 pending verification，无 Stage 2 文件。
- `presentation-johor-waterfront-fair`：`Documentation Required`，Stage 1 verified，canonical `-s2` Stage 2 等待 Admin publication。
- `presentation-craft-market`：`Documentation Required`，五部门 Stage 1 全部 pending verification。

Verifier 会拒绝 unowned records、venue/state 冲突、stale pointers、错误的 Stage 1/2 IDs、缺失 revision、错误 reviewer assignment、control/proposal 不一致和任何 public projection。
