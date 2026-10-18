# PC33 AI 运行时韧性与审计一致性

用户批准范围：Person AI 摘要/会前准备的重复点击互斥及双语失败、历史提示；仅调整 `assistant`、`ai_activity` 的 Gateway 调用链，增加服务端短时去重与 `public` 审计原子终结。保留 Legacy AI、返回结构、人工确认、当前运行时和函数超时配置。使用已配置的 CloudBase 模型，不固定厂商。

## 基线与影响

承接 PC32-D 标签 `release-20261018-102824`、提交 `47db21527ec67c5295fd5c24aaead7a0020db55c`；本轮实际基线以 Git 与云端核对结果为准。线上 29 个 CRM 函数中 24 个 Nodejs18.15、5 个 Nodejs20.19，均固定 `@cloudbase/node-sdk` 4.1.0；`assistant` 超时 90 秒、`ai_activity` 120 秒，不作改动。已有 `public.ai_tasks` 43、`ai_runs` 43、`ai_results` 38；5 条失败 run 均为 `TIMEOUT`，无未终结或孤立结果。CloudBase `cloudbase` 模型组处于启用状态；此配置检查不代表本轮已实际生成模型结果。

影响页面为 Console Person 摘要、会前准备和现有对话策略错误提示；影响接口为 `assistant` 的 Gateway AI 路由及 `ai_activity.postReviewV2`。不改 `admin.html` 旧实现、业务字段、客户/机会/活动事实、手工编辑、Action 执行或登录方式。新数据仅为 `public.ai_request_claims` 的短时请求回执及原有 `ai_tasks`/`ai_runs`/`ai_results` 审计；新 RPC `crm_ai_claim_v1`、`crm_ai_claim_v2`、`crm_ai_finish_v1` 仅授予 `service_role`，新表强制 RLS 且匿名和 authenticated 无授权。

## 实施与恢复

- `20261018110000_ai_runtime_resilience.sql` 建立回执、3 分钟同操作者请求约束和原子审计终结；`20261018111000_ai_claim_shape_guard.sql` 增加完整输入形状核对。两项均有同名 rollback，且本地/用户 CloudBase 迁移备份一致。云端迁移任务 `task-82c79505d0b04991`、`task-ed6cb67b9505426c` 均为 Succeed，历史版本与对象存在；管理工具完成瞬间出现的 `MIGRATION_NOT_APPLIED` 已通过独立任务与历史核实，未重复执行。
- 请求键由 Gateway 对任务、技能、主体、模型组/模型、完整输入及上下文规范化散列；服务端再绑定可信操作者。相同请求完成后 3 分钟内复用原审计结果；处理中、近期失败或过期但仍运行时明确拒绝新模型调用。模型完成与 run/result/task 更新在一个 `public` 事务终结。终结请求状态不明时返回审计错误，不自动再次调用模型。CloudBase 本地 Promise 超时不证明远端取消，故 `TIMEOUT` 不自动重试。
- 部署后首次真实登录的虚构 Person 783 摘要探针返回 `INVALID_INPUT`，请求未进入 AI 审计（仍为 43/43/38，claim 0）。定位到旧摘要服务把 `sources` 放在 `contextSnapshot` 顶层，违反 Gateway 的“除 `_context` 外必须与 context 一致”约束。本包在同一摘要链内把来源列表移入 `_context.sources`，仍按原样返回页面来源；专项测试核对快照格式及返回字段。重新部署 `assistant` 后，摘要真实请求进入模型调用并在现有 30 秒限制处 `TIMEOUT`，task 53/run 52 均终结为失败，无 result、无自动重试。
- 回滚先撤销 v2；v1 回滚在已有请求回执时拒绝，必须评估生产审计数据及函数版本后再处置，不能静默丢失历史。恢复旧代码应以发布标签重部署 `assistant`、`ai_activity` 和两个 Console 文件；不可单独删除已被新代码调用的 RPC。

## 验证

- `tests/pc33/ai-audit-transaction.cjs` 在外层回滚事务中对 public RPC 实际执行 11 项：权限、首次/重复 claim、同键改输入、近期失败、成功原子写入、重放复用、跨操作者、过期不明、注入错误回滚、终态失败。通过后生产 `pc33_test` task/run/claim 均为 0。
- `tests/pc33/ai-claim-concurrency.cjs` 由两个独立服务角色进程测试同键 advisory lock；竞争方锁超时拒绝，回滚后重试成功，持久测试行仍为 0。
- `tests/pc33/person-ai-resilience.browser.cjs` 在隔离浏览器验证中英双语、摘要和会前准备的重复点击只发一次请求、失败/历史提示及 820×1180、1180×820 iPad 无横向溢出。
- `tests/pc33/summary-context.test.cjs` 以虚构 Person 验证摘要快照的来源元数据与 Gateway 契约一致，保留旧返回字段；真实模型结果另以登录探针核对。
- Gateway 与活动适配器 17/17；PC20 5/5、PC22 12/12、PC23 14/14、PC30 10/10、模块检查通过。WP01 完整发布门禁复跑 `PASS_WITH_LIMITATIONS`，目录 1017 项、旧回归 108 PASS/0 FAIL/5 预设 SKIP、匿名 70/70。新建的 4 个 public 对象逐项核验后进入权限基线。
- 应用真实登录的第三次探针仅对同一虚构 Person 783 生成一次对话策略建议：task 54、run 53、result 45；审计为 completed/success、模型回报 `hy3`、耗时 32688 ms，与配置选择一致。探针只保存状态和审计 ID，不保存账号、令牌或模型内容。随后在外层回滚事务中以该真实 claim 的原操作者、请求键和完整快照调用 `public.crm_ai_claim_v2`，返回 `reused`、原 task 54/result 45（RequestId `23569db3-95f4-4763-b4c4-8bbb42520075`），没有第二次模型调用；页面级二次点击由隔离浏览器验证。真实设备、生产业务写入及生产 rollback 未执行。

## 发布

本轮仅上传 `assistant`、`ai_activity` 以及 `/crm/js/modules/console/pages/person.js`、`/crm/js/modules/console/i18n.js`；未上传整个项目。两项云函数部署成功后分别用 CLI 实际调用，`assistant` 请求 `f18d36aa-f8b9-4e56-8570-d039e946828e`、`ai_activity` 请求 `359b3e31-b5c5-4e1d-b65f-4338afb8173c` 均返回预期 `UNAUTHORIZED`，证明未登录边界；真实登录模型结果见上文。最终 Git 提交、标签、线上地址及三端源码核对证据在本轮交付报告中记录。若发布门禁、Git 或核对失败，本包保持未完成并先恢复可用性。
