# 同基础姓名、不同限定词的人物新增修复（2026-10-22）

## 基线与原因

- 修复前本地及 GitHub `master`：`f642efaed32bed15fd0b28b3f94d3c3b02ca0784`，发布标签 `release-20261022-220033`；独立检出完成的基线核对显示线上页面、75 个前端资源、29 个云函数的 202 个源码与配置文件一致。
- 线上只读查询 `public.persons`：报告中的基础姓名仅有一个活动人物候选，拟新增的完整显示名不存在。发布记录不保存真实人物姓名与编号。
- `PersonService.resolveName()` 对新姓名返回 `status=confirm_existing` 及 `canCreateAfterConfirmation=true`：同基础姓名只有一个候选，限定词却不同。Console 人工新增、快速记录及 `person_360.previewIdentity` 原先只接受 `available` / `confirm_new_qualified` 状态，忽略这个允许人工确认新建的结果，因此阻止新建。数据库预览及执行函数已经允许带不同限定词且完整显示名不重复的建档。

## 修复范围与兼容性

- 仅调整 `crm/js/modules/console/write.js` 中人工新增人和快速记录的新建资格判断，以及 `cloudfunctions/person_360/index.js` 的预览资格判断。发现同名候选时仍显示候选；只有服务端给出 `canCreateAfterConfirmation=true`，且候选未超限、没有同显示名已删除身份时，才展示新建并允许预览。提示语复用现有中英文字典项。
- 完全相同的显示名、未加限定词的同基础姓名仍拒绝新建；已有候选不会自动选中。预览、人工确认、数据库执行时的候选指纹及同名再校验保持不变。
- 未修改 `public` 数据、数据库对象、权限、其他云函数、客户/增员角色或旧业务流程；无需 migration/rollback SQL。仅部署 `person_360` 与 `/crm/js/modules/console/write.js`。

## 验证与发布

- 修复前相关单元测试 22/22 通过；新增针对“一个同基础姓名候选、不同限定词”的服务端和浏览器流程用例。最终针对性测试 9/9 通过；Person、快速记录及相邻目录测试 24/24 通过。
- 跨模块隔离回归：108 PASS、0 FAIL、5 个预设线上跳过项；覆盖登录、客户列表/详情、跟进、活动、增员和回收站。
- WP01 发布安全门槛重新采集 `public` 只读权限目录及 WP04 人物映射审计；PC34 实际服务角色只读探针、71 项匿名探针通过，最终门槛为 `PASS_WITH_LIMITATIONS`，无阻断项。真实登录与线上写入未执行；不拿真实人物执行新增/删除测试。
- 已仅部署 `person_360` 函数及 `/crm/js/modules/console/write.js`。上线模块以 HTTP 200、SHA-256 与本地一致核对；部署后使用管理端实际调用 `person_360.resolveIdentity`，函数正常启动，未带应用用户身份时按预期返回 `UNAUTHORIZED`（Request ID `054278dd-c95f-4679-a23b-cb08cdc79952`）。此调用不能替代登录后的新增业务验收。
- 发布前 `sync-check.ps1 -CloudOnly` 全部通过：线上页面、75 个前端资源、29 个函数的 202 个源码与配置文件同本地一致。GitHub 提交与发布标签由 `tools/release.ps1` 生成，最终值以发布输出为准。

## 恢复

若本轮出现线上故障，以 `release-20261022-220033` 中的 `person_360/index.js` 和 `crm/js/modules/console/write.js` 为代码恢复依据，仅重发上述两个产物并创建新的恢复提交与标签；不强推、不静默变更业务数据。数据库未改变，无 SQL 回滚。
