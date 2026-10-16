# PC18 活动复盘候选确认执行与结果

日期：2026-10-16

基线：`5e62ad7322f8aec63e440db9511d2458c9703cbb` / `release-20261016-131205`

## 范围与结果

- 活动复盘页先展示已生成版本、六项复盘内容、Action/Opportunity 候选、来源、人物和候选状态；置信度只显示 AI 结果实际提供的值，缺失时明确标为“未提供”。没有充分来源的候选继续为空，不由界面补造。
- 打开复盘页不再自动触发 AI。用户可主动生成新版本，历史版本和人工决策分别展示；候选默认待确认，也可保留待确认。
- 采纳、拒绝和记录实际 Outcome 均先调用现有服务端 Preview，再由用户核对并确认执行。服务端在执行时重新核验活动、人物和证据版本；版本变化时拒绝执行，用户重新预览后再试。成功结果显示 Action、Opportunity Candidate 或 Outcome 的业务记录 ID。
- 新增只读 `listActivityReviewHistory` action，限定活动 ID，最多读取 20 个复盘任务、100 个结果、300 条已执行决策和 20 条 Outcome。响应不含命令的 actor UID 或 request hash；来源并入现有测试数据披露检查。
- AI 建议行动仍写入 `public.actions`；现有 Person 工作项与 Today 工作台共用该表和 `WorkItemService` 查询，因此可见同一行动。旧 `admin.html` 复盘入口和 `listActivityOutcomes` 路由保留。
- 新 UI 位于 Console 模块，中文和英文来自 `i18n.js`；仅按 iPad 横竖屏检查。没有数据库迁移、权限变更、路由移除或旧页面改造。

## 影响与兼容

- 页面：Console 活动详情的复盘标签；新增 `activity-review.js`，更新 Console `activities.js`、`data.js`、`i18n.js`、`console.css`。
- 接口：`person_360` 增加一个登录后只读 action，并为 `crm_activity_review_commands` 增加仅 GET 的服务端 allowlist；已有 Preview/Execute RPC 不变。
- 数据：仅查询 `public.activities`、`public.ai_tasks`、`public.ai_results`、`public.crm_activity_review_commands`、`public.outcomes` 和候选引用来源。业务写入继续由已有 service-only 原子 RPC 负责。没有访问 `pr` schema 或 `pr_*` 函数。
- 回滚基线：`release-20261016-131205`。恢复 `person_360` 及本轮 5 个静态托管文件到该标签版本并按发布流程建立恢复提交；本轮无数据库数据回滚。

## 验证

- PC18：`npm run test:pc18`，4/4 通过。覆盖历史范围/披露、无证据候选、候选确认与拒绝、Outcome、stale Preview 拒绝、双语与 iPad 横竖屏。
- 既有活动回归：`npm run test:pc16` 2/2、`npm run test:pc17` 4/4；`tests/wp12/activity-review-workflow.cjs` 与行动/互动边界测试通过。
- 旧入口及全站浏览器回归：`node tests/regression/run.cjs --browser-only`，72 PASS、0 FAIL、6 个预先声明的 skip；包括 Legacy 活动复盘候选确认、拒绝和 Outcome 流程。
- 前端模块门禁、`node --check`、`git diff --check`、`npm run check:shared` 通过；共享模块 29 个函数的 58 份副本一致。
- WP01：108 PASS、0 FAIL、5 个既有 skip；catalog 907 项无差异，匿名探针 65/65，release gate `PASS_WITH_LIMITATIONS`、无 blocker。公开 schema identity audit 保留 3 条已登记参与者例外。
- 未使用真实客户数据；交互回归均为虚构样本，没有执行生产业务写入。

## 发布记录

- 云函数：仅部署 `person_360`，通过 `tools/deploy-function.ps1` 完成共享副本校验后上传成功。
- 静态托管：仅上传 `activity-review.js`、`pages/activities.js`、`data.js`、`i18n.js`、`console.css`，5/5 成功；没有上传 `admin.html` 或项目目录。
- 部署后 CloudOnly 检查：线上 `admin.html` HTTP 200 且 SHA-256 相符；62 个可达页面/模块/样式资源与本地一致；29 个 CRM 函数的 184 份源码/配置一致。
- 函数无写入探针：MCP invoke 因 CAM 鉴权失败未执行；CLI 对 `person_360` 发送未知 action 后实际返回 `UNAUTHORIZED`，RequestId `dcbfd6cb-1deb-4074-b36f-76022ef43cdf`。证明函数运行和匿名身份被拒绝，不代表已验证真实登录或服务角色查询。
- Git 发布：标签 `release-20261016-134337`；完整推送与 post-release sync-check 结果由发布脚本核验。

## 未验证项

- 未使用真实登录会话读取生产复盘历史，也未在生产生成 AI 版本或执行候选/Outcome 写入。服务端角色下的实际在线历史读取、重复执行回放及来源去重由既有 RPC SQL 保护，但本轮只做隔离回归，没有生产写探针。
- 未验收真实用户账号下 Person 和 Today 的线上即时展示；依据是两处当前均调用既有 `WorkItemService` 读取 `public.actions`。
- 未做手机适配或手机验收，符合该任务的 iPad 边界。
