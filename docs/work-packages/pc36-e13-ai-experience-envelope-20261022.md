# PC36 E13：AI 建议与实际结果入口请求修复（2026-10-22）

## 事实与范围

- 用户在生产 `#/ai/experience` 看到标题和“AI 结果”，但列表为空，提示“保存未完成，请刷新后核对”；未提交反馈、Outcome 或 Learning。
- 生产 `assistant` 日志的该入口调用返回 `INVALID_INPUT`。`ai-experience-service.js` 对请求业务字段执行完全匹配校验，而 `assistant/index.js` 原先将带有 CloudBase 传输附加字段的完整 event 直接转交该服务；列表及工作项读取在数据库查询前被拒绝。
- 初次核对基线为本地/GitHub `f642efaed32bed15fd0b28b3f94d3c3b02ca0784`、标签 `release-20261022-220033`；受影响的云端 `assistant` 源码与本地一致。全量核对同时发现另一工作区正在发布的人物身份修复：线上 `person_360/index.js` 及 `write.js` 已更新、GitHub 尚未提交，因此未覆盖其产物。
- 并行包随后独立发布为 `95b2e483c72320a0ab625e8c2be17bee7bcfb971`、标签 `release-20261022-224131`，已接入本地 `master`；该包的云端源码核对记录为 75 个前端资源、29 个函数的 202 个源码与配置文件一致。`assistant` 云函数最近修改时间仍为 2026-10-21 11:12:11，未被并行包部署。
- 用户已批准仅修 `assistant` 的 `aiExperience` 请求投影并执行隔离与相邻流程回归。本包不改数据库、模型、页面、权限或其他入口。

## 变更与兼容

- `assistant/index.js` 按 `list`、`targets`、`decide`、`outcome`、`learning`、`confirmLearning` 六种操作只向 AI Experience 服务转交该操作的声明字段，忽略传输附加字段。
- 伪造操作者和跨操作业务字段仍明确拒绝；业务服务原有严格校验继续处理缺字段、非法类型、权限及人工确认。服务端身份仍由 `getUserInfo()` 提供；未登录与匿名调用保持拒绝。
- 原页面及 PC29 的人工反馈、实际结果和 Learning 流程不变；本修复不写业务数据。无需数据库迁移或 SQL 回滚。

## 隔离验证

- `node --check cloudfunctions/assistant/index.js`、`git diff --check`：通过。
- PC29：11/11，通过列表/工作项元数据投影、六种操作字段、伪造操作者及跨操作拒绝、双语 iPad 页面与旧 PC29 契约。
- PC26：21/21；PC27：20/20；公共回归：108 PASS、0 FAIL、5 SKIP。
- 新基线上 WP01 门禁：`PASS_WITH_LIMITATIONS`，0 阻断；`public` 目录和人物映射证据新采集，71/71 匿名探针与 PC34 服务角色只读探针通过。真实登录、服务角色写入和移动端为明示未验证项。
- CloudBase 代码审查：登录态与匿名拒绝未改，操作者身份由服务端获取；未回显 event、运行时上下文或环境变量；未新增数据直连。

## 发布与回滚

- 只部署 `assistant` 云函数；测试与本记录只进 Git。发布前已等待人物身份包独立完成，并在新 `master` 上重新执行发布门槛。
- `assistant` 代码已用 `tools/deploy-function.ps1 -Function assistant` 单独上传。部署后 `sync-check.ps1 -CloudOnly` 通过：75 个前端资源及 29 个函数的 202 个源码/配置文件与本地一致，证据目录为 `D:\Temp\crm-cloud-audit-cc211872ee0a4cefb0cf56f486a0cbf8`。
- 管理端对 `assistant` 的匿名只读调用被 CloudBase CAM 前置鉴权拒绝，未进入函数，不能充当业务验收。用户刷新登录后的生产页面后，2026-10-22 23:15:28、23:15:31 的 `list` 与 `targets` 真实调用均返回 `ok:true`，页面已显示 AI 结果；未执行反馈、Outcome 或 Learning 写入。当前默认选中的是另一条机会命令结果 #76，活动复盘 #50/#51 尚待人工定位和核对。#76 的原始 JSON 展示问题另记为页面问题，不纳入本次仅修服务端入口的授权范围。
- 本包按既有发布脚本提交、推送并打独立标签；发布完成后以脚本输出和三端核对结果登记提交与标签。
- 如需恢复代码，以本包发布前标签中的 `cloudfunctions/assistant/index.js` 为依据，仅重发 `assistant` 并创建恢复提交与标签；无数据库回滚。
