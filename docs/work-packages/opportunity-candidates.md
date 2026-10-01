# Person 机会候选与人工确认

实施日期：2026-10-01。基线 `1943aae7c03ade7025be7b2fa247f6d55dbfe296`，标签 `release-20261001-065816`；开发前本地、GitHub、28 个云函数及 143 个源码/配置文件一致。用户已明确同意完整候选到确认流程。

Person 360 新增独立候选卡片，原“经营机会”手工入口、旧客户机会页、Quick Capture、Today、漏斗均保留。`assistant` 继续验证真实登录身份，复用原服务端数据库密钥及 AI Gateway；新 Skill 由 CloudBase 配置选模型。没有新增模型厂商绑定或浏览器数据库密钥。

生成候选时读取当前 Person 的有限字段和最多 30 条有来源摘要：Interactions（包括客户和增员旧跟进的读取映射）、有效 Context Items、实际到场活动、招募资料与跟进、保单产品存在性、人工编辑的保单检视、少量 OCR 摘要与照片元数据，并检查既有机会。不会发送完整历史、OCR 原文或照片内容。来源为空、只有活动到场或保单存在、或 AI 引用了不存在的来源时，不创建候选。Signal 和未经确认的资料仍标记为待核实；“没有记录”不被解释为需求或保障缺口。

`public.opportunity_candidates` 仅供服务角色访问；AI 运行结果关联 `ai_results`，服务端核对 Person、来源引用、AI 结果和状态。人可编辑或拒绝。正式创建执行 `preview → confirm → execute`：预览显示 Person、类型、依据、下一步及来源，有效 15 分钟；确认绑定登录 UID 和预览摘要；执行时再次检查 Person、来源与重复机会，并在同一数据库事务里仅创建一条 Person 专属 `public.opportunities`，记录 `ai_results` 的人工选择与编辑。重复执行返回同一正式机会。新机会的 `customer_id` 为空，旧视图的客户机会行为不变。

数据库 migration 为 `cloudbase/migrations/20261001090000_opportunity_candidates.sql`，rollback 为 `cloudbase/rollbacks/20261001090000_opportunity_candidates.sql`。Rollback 遇到任何候选审计记录即拒绝删除，需先评估实际机会与审计，不自动删除线上数据。新表与 RPC 均不授予 `anon`/`authenticated` 直接访问。

验证：migration 任务 `task-381cb03b` 成功；权限只读查询显示 `anon`、`authenticated` 无表 SELECT 与 RPC EXECUTE，`service_role` 具备。`tests/assistant/validate-opportunity-candidate.sql` 使用 `[CRM_TEST_ONLY]` 记录在单个事务内验证无确认拒绝、错误身份/摘要拒绝、确认前无正式机会、一次执行与重放去重，并在同一块回滚；执行后测试 Person、候选、机会、AI Task 数量均为 0。离线 Skill/服务测试 11 项通过；完整旧功能及新增页面回归 87 项通过、0 失败、5 项原有跳过。真实登录的只读探针返回 `listed/0/INVALID_INPUT`，没有调用模型或业务写入。三个静态文件线上 HTTP 200 且 SHA-256 与本地一致。

限制：未对真实客户自动生成机会或进行真实账号的模型正向调用；当前线上新 `interactions`、`context_items` 为空，AI 需依赖已有旧跟进、招募资料或人工编辑检视，证据不足时返回“不生成”。人仍需核实来源内容后确认。
