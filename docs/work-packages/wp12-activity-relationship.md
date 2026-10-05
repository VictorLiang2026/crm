# WP12｜活动关系闭环

基线：`b3929f1ceda22b5ffca0db7c456880a8b0153ea2`、`release-20261004-234100`。修改前本地、GitHub 和云端的 25 个静态资源、28 支 CRM 函数及 165 个源码/配置文件一致。仅使用 `public`；初始虚构业务种子仍为 10 行。界面只按 iPad 范围验收。

## 影响和兼容范围

| 范围 | 本包变化 | 保留的旧行为 |
| --- | --- | --- |
| 页面 | 现有活动详情的独立 `activity-review-v2` 模块新增 Action/Opportunity Candidate 的逐项审核、拒绝、服务端预览与确认，以及实际 Outcome 的预览确认；显示来源和“含测试数据” | 旧 `ai_activity.postReview`、活动详情/参与者/嘉宾/任务、旧 URL 不替换 |
| 接口 | `ai_activity.postReviewV2` 对有界的活动上下文生成 AI 审计与候选；`person_360.previewActivityReview` / `executeActivityReview` / `listActivityOutcomes` 使用原登录网关 | 现有 Person 360、WP07 V2、WP08 Action、WP10 机会候选接口保持可用 |
| 字段和数据 | 不改已有基表列。新建 `public.crm_activity_review_commands` 和 `public.crm_activity_review_source_claims`，用于 15 分钟预览、幂等结果、逐来源防重；获人工确认后只写既有 `interactions`、`actions`、`opportunity_candidates`、`outcomes` | 旧客户机会和 Legacy 跟进不迁移、不批量回填、不按姓名合并 Person；普通报名不写高价值互动 |
| 权限 | 两张台账表和两个 RPC 仅 `service_role`，强制 RLS；匿名与普通认证角色无权读取或执行 | 其他表、视图、函数权限不扩大 |

活动参与者优先用已确认的 `canonical_person_id`，旧客户、增员和嘉宾仅通过精确外键找到有效 Person；没有身份依据时拒绝生成候选。仅真实到场或重要性达标、人工确认的实质互动可支持 Action Candidate；Opportunity Candidate 必须有同一活动和 Person 的重要互动来源。后端再次核实 AI 审计、候选索引、Person、来源及活动状态。重复预览或执行由 UUID 和事务锁保护；同一实质来源被接受后不能通过增加其他引用再次接受。拒绝候选只记决定，不创建行动或机会。结果记录只接受已发生的人工事实，不自动改变机会或行动状态。

测试账号只能操作已登记的虚构活动及 Person；页面文字保留 `【系统测试·勿联系】`，没有真实外发入口。复盘模型由 CloudBase / AI Gateway 配置，未硬编码厂商。新增迁移及回滚：`20261005001000_activity_interaction_dedupe`、`20261005003000_activity_review_commands`。两项于 2026-10-05 00:35–00:37 北京时间通过 CloudBase 迁移任务成功应用；只读复核两张新表均强制 RLS，`anon`/`authenticated` 不可读，两个 RPC 也不可执行，初始种子仍为 10 行。

## 验证与恢复

本地 `npm run test:ai-gateway`、`npm run test:ai-skills`、`npm run test:interactions`、`npm run test:modular` 通过；`npm test` 初轮 100 通过、0 失败、5 个既定跳过。新增浏览器验收覆盖“未预览不执行”“逐项接受/拒绝”“机会候选和 Outcome 独立确认”，以及相邻旧客户、招募、活动、Today、回收站与 WP07 V2，`npm run test:browser` 为 66 通过、0 失败、6 个既定跳过。隔离浏览器发现拒绝候选误报已保存，现已修正并复验通过。

首个阶段版已以提交 `597649805c79996316245546f8784d42d739b6a3`、标签 `release-20261005-010922` 发布；本地、GitHub 和云端源码核对一致。后续生产验收与编号可见性阶段发布证据如下。

2026-10-05 验收补充：用户反馈活动列表和参与者卡片缺少编号，并专项确认只读显示调整。`admin.html` 现显示活动列表/详情的 `public.activities.id`，以及活动详情每张参与者卡片的 `public.activity_participants.id`；现有 `activities.list/get` 已返回 ID，未改接口、数据或权限。隔离完整回归 102 通过、0 失败、5 项既定跳过，浏览器回归 66 通过、0 失败、6 项既定跳过；第一次受限 Edge 无页面目标、一次 Today 加载超时，均未改业务代码，在允许本机回环的环境重跑通过。WP01 权限目录 784 项、身份审计、匿名探针与发布门槛通过，登录摘要因页面哈希变化仍需重新采集。仅上传 `/crm/admin.html`，上传后页面 SHA-256 与本地一致；这只是编号可见性的阶段发布，未据此标记整包完成。阶段提交 `d9c8ca2775813a663293da908075b84cc2ba0d5a`、标签 `release-20261005-100334` 已推送，发布后三端核对通过。

生产 prtest 已只读确认三个编号显示。随后人工确认虚构参与者 #18 的实质沟通，生成 `public.interactions#11`，精确关联活动 #11、Person #783，摘要含测试标记，`crm_test_records` 逐 ID 记为 derived；初始种子仍为 10 行。`ai_activity.postReviewV2` 产生审计 task/run/result #19，逐 ID 记账，引用 `public.interactions#11`；AI 未提出有充分证据的新机会，错误引用旧互动的行动候选被后端过滤。预览后活动 #11 的 Action、Opportunity Candidate、Outcome 仍均为 0，未凭 AI 内容写业务事实。

随后 prtest 人工核对服务端 Outcome 预览：命令 `ce61aceb-b79b-4798-a9aa-440bde1de6ee` 在预览时 `executed_at` 为空，Action、Opportunity Candidate、Outcome 都未增加；人工确认后只产生 `public.outcomes#2`，关联活动 #11，`action_id`/`opportunity_id`/`interaction_id` 为空，内容带测试标记，不宣称真实成交或联系。命令记录 `result_json.outcomeId=2` 并已执行，测试台账将 Outcome #2 记为由活动 #11 衍生，初始种子仍为 10 行。同行为的重复预览 ID 返回原结果由事务 SQL 与夹具核验；线上未借新预览再次造一条结果。

生产时间线曾将活动互动 #11 的内部类型 `conversation` 直接显示为标题。仅在具有 `activityId` 的四种重要互动上加入中文标签，旧客户/招募跟进与其他互动类型保持原映射；不改字段、接口、权限或数据。`node --check`、模块检查、WP06 5 项和全量 102 项回归通过，新的 WP01 权限目录/身份审计/匿名探针与发布门槛通过；只上传 `/crm/js/modules/person-insights.js`，本地与线上 SHA-256 相同。原浏览器标签仍保留旧 ES 模块；prtest 强制新开完整页面后确认互动 #11 标题为“实质沟通”，其“查看活动”可进入 #11，“实际到场”仍是独立记录。旧嘉宾资源列表正常，旧 `✨ AI 活动复盘` 显示六维建议，未采纳建议或外发。

最终只读核对：活动 #11 的 Person #783 重要互动 1 条（#11），Action 0 条，Outcome 1 条（#2），本轮 AI 结果 #19 对应正式机会候选 0 条；初始种子仍为 10 行。互动 #11、Outcome #2 和 AI task/run/result #19 都在 `crm_test_records` 可按 ID 追踪。普通报名未生成高价值互动；服务端精确来源索引和逐来源认领阻止重复接受，相关拒绝/重放由本地夹具及迁移 SQL 验证。真实模型因现有行动/机会和证据不足，没有给出可接受的新候选，故**线上接受/拒绝 Action 或 Opportunity Candidate 的正向写入未执行**；没有为凑验收伪造第 11 条初始样本或强行采纳无来源候选。服务角色真实写入探针、真机 iPad 视觉验收未执行；按长期约定不做手机布局验收。

WP12 收尾仅修改 `person-insights.js` 与本报告/任务清单，未再改 `public` 数据库或云函数。收尾标签须在发布脚本成功及三端核对后记录。回退 UI 从 `release-20261005-100334` 恢复 `person-insights.js` 并做新恢复提交，只部署该静态文件；撤销整包则从 WP11 基线 `release-20261004-234100` 逐项恢复本包模块和函数，先核对互动 #11、Outcome #2 与 AI 审计 #19 的保留/归档要求。`20261005003000_activity_review_commands.rollback.sql` 对已执行命令会拒绝删除台账，不能静默清除已确认结果。

代码回退从基线标签创建恢复提交并仅重部署本包变更的活动模块、样式、`ai_activity`、`assistant`、`person_360`；不强推。若要移除新命令台账，先核对已接受的 Action、Opportunity Candidate、Outcome 及其测试登记 ID；回滚脚本发现已写业务行即拒绝删除，不能静默清除。人工互动唯一索引可用独立 rollback 移除，但须先评估此后重复写入风险。无需回滚既有基表或视图，因为本包未改其结构。
