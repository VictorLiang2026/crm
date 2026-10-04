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

生产测试账号、真实 AI 模型输出及衍生 ID 的最终验收、发布提交与标签待本轮后续记录补齐。未确认前不能把本地通过等同线上业务成功。

代码回退从基线标签创建恢复提交并仅重部署本包变更的活动模块、样式、`ai_activity`、`assistant`、`person_360`；不强推。若要移除新命令台账，先核对已接受的 Action、Opportunity Candidate、Outcome 及其测试登记 ID；回滚脚本发现已写业务行即拒绝删除，不能静默清除。人工互动唯一索引可用独立 rollback 移除，但须先评估此后重复写入风险。无需回滚既有基表或视图，因为本包未改其结构。
