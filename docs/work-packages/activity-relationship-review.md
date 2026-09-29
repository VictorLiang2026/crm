# 活动关系复盘预览

基线：`a0a61f00dde861facaf926afaa781821ca5aac97` / `release-20260929-202734`。修改前本地、GitHub `master`、线上页面和 27 个 CRM 云函数源码一致。本轮只用 `public`，未变更数据库结构或权限，不需要 migration/rollback。

`ai_activity.postReview`、`participantReview` 和页面上的旧采纳/完成复盘动作保持原样。新增独立 `postReviewV2`：必须有非匿名 CloudBase 登录，且活动已结束或已复盘；专用服务端 API Key 仅在该函数内使用。Context Engine 仅取本场活动、最多 20 位参与者与已确认 Person、20 条互动/行动/关系、5 条机会等有限字段，并为每条输入标记 `public.表#ID` 来源；未确认的旧参与者姓名不进入该上下文。

AI Gateway 使用现有 CloudBase 模型配置，经 `activity_review` 2.0 契约输出六项回答及 Action Candidate。新入口只返回预览：仅展示引用了本次上下文来源的判断，仅展示与已确认 Person 关联的行动候选；不自动创建 Person、Interaction、Action、Opportunity，也不改变旧活动状态。Gateway 按既有 AI Runtime 设计写入 `public.ai_tasks`、`ai_runs`、`ai_results` 审计记录，不把候选写入业务事实表。关系变化、信号和机会均标为待人工核实的研判。

影响文件：`ai_activity` 函数代码及 120 秒超时配置、`admin.html` 活动详情、独立 `/crm/js/modules/activity-review-v2.js` 与 `/crm/css/activity-review-v2.css`、共享 Skill Registry/Context Engine 和测试。回滚版本为上述基线标签；无需回滚数据库业务数据，已产生的 AI 审计记录应保留。

本轮计费核对：生产环境为个人版，状态 NORMAL，`EnvDeductionMode=credits`；CloudBase 已启用 `cloudbase` 分组的 `hy3`。2026 年 6 月起旧 Token 资源包停售，资源点套餐可抵扣模型 Token 使用量；先前以旧资源包数量为零判定不可调用，是错误判断。按用户确认使用 CloudBase 套餐资源点，程序不硬编码具体模型厂商。

验证：`npm run test:context-engine` 19 PASS、`npm run test:ai-gateway` 14 PASS、`npm run test:modular` PASS；完整隔离回归 81 PASS / 0 FAIL / 5 SKIP（包括旧 `postReview`、新关系复盘、活动参与者、客户、Today、Person 360、增员和回收站）。函数未登录直调 `postReviewV2` 返回 `UNAUTHORIZED`，RequestId `c5380888-2aa6-490b-bc59-d63ba0e2b16a`。测试账号经独立浏览器真实登录，对线上已有结束活动 #2 只生成一次预览：六项结构齐全、1 条 Action Candidate、`task_id=1`、无错误，响应明确 `business_data_written=false`；该验证只将计数写到本机临时目录，不留客户内容。已上传的两个新静态文件 HTTP 200 且 SHA-256 与本地一致；`admin.html` 与 27 个云函数通过云端源码核对。线上 AI 审计表未单独再查，任务和结果 ID 由 Gateway 成功响应提供。离线回归及单次在线预览不覆盖各类历史活动或写入流程。

部署范围：`ai_activity` 函数代码和超时/密钥配置，静态托管仅 `/crm/admin.html`、`/crm/js/modules/activity-review-v2.js`、`/crm/css/activity-review-v2.css`。专用 API Key 名为 `crm-activity-review-server`，在函数环境变量中保存，不入 Git 或浏览器；密钥到期前需轮换。旧函数与页面入口均保留。
