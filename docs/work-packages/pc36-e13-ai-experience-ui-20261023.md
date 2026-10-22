# PC36 E13：AI 结果与回执页面修复

日期：2026-10-23。范围经用户单独确认：仅修 Console「AI 建议与实际结果」的结果展示、反馈 JSON 校验、保存回执及同页反馈重试。未修改 `public` 数据库、Cloud Functions、AI 模型、业务执行规则或旧入口。

## 基线与影响

- 修改前本地、GitHub `master`、CloudBase 完整源码一致，基线提交 `e5692f1a08f6d4d3f15cc6f02dedae32408eb39b`、标签 `release-20261022-231900`；`tools/sync-check.ps1` 核对 75 个静态资源和 29 个函数的 202 个源码/配置文件通过。
- 影响页面：`#/ai/experience`。结果 #76 原样显示 `unsupported` JSON；活动复盘结果 #50/#51 原样显示长 JSON；保存成功状态被页面重新加载清空，易引发重复点击；非法「修改差异 JSON」只显示通用失败。
- 仅改 `crm/js/modules/console/ai-experience.js`、`crm/js/modules/console/i18n.js`、`crm/css/ai-experience.css` 和隔离浏览器用例。结果正文仍保留原始 JSON，可由用户展开；来源 ID、服务端权限和判断/Outcome/Learning 人工流程保留。中英双语，iPad 820/1180 宽度。
- 同一页面内，反馈的 AI 结果、判断、原因及规范化 JSON 差异完全相同时复用原 `eventId`；不同判断或内容使用新键。服务端既有幂等和操作者校验继续生效。保存回执持续显示，若读回失败明确提示先核对、勿重复提交。

## 虚构验收数据与回归

- 活动 #11 的 AI 结果 #50 因 Action 候选缺少本场来源被人拒绝；关联中性实际结果 #26，未据此创建行动或机会。#51 Action 候选引用 `public.interactions#11`，经人修改后创建行动 #17（仍开放），机会候选未执行；关联中性实际结果 #25。上述均为已登记「勿联系」虚构数据，不证明业务效果。
- `npm run test:pc29` 12/12；`npm run test:pc24` 22/22；`npm run test:pc25` 23/23。隔离浏览器覆盖 #76 类型的可读拒绝、#50/#51 类型的来源摘要、原始 JSON 折叠、最新人工判断、无效 JSON 阻止请求、保存回执、同页相同反馈复用键及双语 iPad。
- 全站回归 `108 PASS / 0 FAIL / 5 SKIP`；WP01 新鲜目录 1036 项权限断言无失败，匿名网关 71/71，PC34 关键角色、`service_role` 只读与双语 iPad 核查通过。WP01 为 `PASS_WITH_LIMITATIONS`、阻断项 0；真实登录证据已过期，生产写入和实机触控不由此推断通过。
- CloudBase 代码审查：本包仅使用现有 `callFn`，没有浏览器直连数据库/存储、凭据、动态 HTML 注入、权限或 Schema 变更；AI 原始结果经 `textContent` 展示，避免将模型文本当 HTML 执行。
- CloudBase 静态托管精确上传上述 3 个资源，返回 `successCount=3`、`failedFiles=[]`，无函数或数据库部署。上传后 `sync-check.ps1 -CloudOnly` 核对页面、75 个可达资源，以及 29 个函数的 202 个源码/配置文件全部通过；证据目录 `D:\Temp\crm-cloud-audit-a6a3800c1b2249e0a48ac1c22db7071e`。
- Git 发布标签 `release-20261023-003115`；提交、推送与发布后三端核对由 `tools/release.ps1` 执行，失败不得将本轮标为完成。

## 发布与恢复

仅上传上述三个已变静态资源，不上传目录、不部署函数、不执行迁移。回退页面文件从基线标签精确恢复并创建恢复提交和标签；不自动撤销已记录的人工反馈、Outcome 或 Learning。生产实际结果展示需在部署后核对；本包不自动新增业务记录。
