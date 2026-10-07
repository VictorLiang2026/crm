# 影响矩阵（字段 / 函数 / 调用方 / 工作包映射）

用途：跨包追踪每个被修改的字段、表、视图、云函数 action、页面入口的消费者与影响面；修改共享模块前按执行约定 H 先登记全部消费者。PMC-00 无业务变更，本文件以初始映射基线起步，后续每包更新。

## 维护规则

1. 每包涉及字段、表/视图、云函数 action、页面入口变化时，在对应分节追加行：`对象 | 变化类型 | 调用方/消费者 | 所属包 | 状态 | 证据`。
2. 共享模块（db.js / ai.js 副本）变化必须列出全部受影响函数目录及部署清单。
3. 状态取值：计划中 / 已实现 / 已部署 / 已验收 / 已回滚。

## PMC-00 基线：无业务变更记录

| 对象 | 变化类型 | 调用方/消费者 | 所属包 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `tools/tcb.ps1` | 修改：增加显式子命令守卫（拒绝无命令/首参为 flag 的裸调用） | sync-check.ps1（`fn code download`）、deploy-function.ps1（`fn code update`）、人工只读命令（`fn list`） | PMC-00 缺口处置 | 已部署（Git，本地工具；云端无关） | evidence/PMC-00.md 第九节 G2 |
| `tools/sync-migration-backup.ps1` | 新增：迁移双备份非破坏性同步脚本（归档旧稿→镜像→哈希校验，含 -DryRun） | 发布迁移包前的人工执行；后续涉及数据库的 PMC 包 | PMC-00 缺口处置 | 已提交；**待用户沙箱外首次运行验证** | evidence/PMC-00.md 第九节 G1 |
| `tools/pg-readonly.cjs` | 新增：Trae/Codex 共用只读 PG 查询（SELECT/WITH 单语句，拒绝 DDL/DML/多语句） | PMC 各包只读证据采集（替代临时候选脚本） | PMC-00 缺口处置 | 已验证（persons=784 + 3 类拒绝路径） | evidence/PMC-00.md 第九节 G3 |
| `tests/wp01/static.cjs` | 无变更（核实 console.html 入口早已存在） | sync-check / WP01 gate | PMC-00 缺口处置 | 已核实：50 资产含 48 console 链 | evidence/PMC-00.md 第九节 G4 |

## 已知共享模块消费者基线（接管时事实）

- `cloudfunctions/_shared/db.js`、`ai.js`：28 个 CRM 函数目录各持副本，共 56 份；2026-10-07 sync-check 全部与 `_shared` 一致（SHA-256：db.js `124c6ac6…`、ai.js `6fa94a41…`）。任何修改须经 `npm run build:shared` + `check:shared` 并逐函数部署。
- `crm/js/modules/console/i18n.js`：Console 全部页面消费；新增界面文本必须入字典（AGENTS.md 规则 17）。
- 视图依赖：任何基表加列/改列前，用 `pg-view-rebuild-check` skill 核对依赖视图清单（2026-10-02 基线：10 个视图全部 security_invoker）。

## 各领域当前调用方速查（接管时事实，按包更新）

| 领域 | Legacy 入口（admin.html 路由） | Console 入口（crm/js/modules/console/） | 主云函数 | 备注 |
| --- | --- | --- | --- | --- |
| 客户 | #/customers、#/customer/:id | customers 等页面 | customers / followups / products / gifts / photos | 回收站级联靠同一 deleted_at 时间戳 |
| Person 360 | （旧详情 #/customer/:id 保留） | person 页 | person_360 | interactions 查询经 person_360 委托（service_role） |
| 机会 | （旧 customer 机会） | opportunities 页 | opportunities | Person 专属与旧 customer 机会权限隔离 |
| 活动 | #/activity/customer | activities 页 | activities / activity_reports / activity_tasks / activity_topics / activity_speakers | 活动详情互动/名单/机会候选页签已上线 |
| 招募 | #/recruit、#/recruit/:id | — | recruit_candidates / recruit_followups / recruit_goals / recruit_score / recruit_recommend | WP13 未实施；Person-only 招募待设计 |
| AI | #/ai-suggestions | assistant 相关页面 | assistant / ai_parse / ai_recommend / ai_recommendations / ai_activity / ai_followup / today_coach / funnel_insight / ai_referral | 模型由 AI Gateway 配置 |
