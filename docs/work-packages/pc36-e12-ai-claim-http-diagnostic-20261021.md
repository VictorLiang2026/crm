# PC36 E12：搜索审计请求登记修复

2026-10-21。用户批准独立诊断 `public.crm_ai_claim_v1/v2` 的过期重试路径，只在证实问题后修复，并保留同请求重用、操作者绑定、并发及失败拒绝。基线提交 `5546603460fa9dbeefb7d7145b16b3504c92eec7`，回滚标签 `release-20261021-010330`。修改只涉及 `public.crm_ai_claim_v2`、`assistant/search-data.js` 的脱敏错误分类和相应测试；`v1`、模型选择、搜索 SQL、权限、旧 AI 返回均未改。

生产搜索在模型调用前被 `public.crm_ai_claim_v2` 以 HTTP 400 拒绝。脱敏云函数日志仅记录状态 400、类别 `CLAIM_INPUT_MISMATCH`，不含查询正文、账号、凭据或原始数据库错误。初步用无测试标记的已完成任务在回滚事务中重试成功，不能代表故障不存在；进一步检查虚构搜索任务 #67 发现：`public.crm_test_link_ai_v1` 在其完成后给 `context_snapshot` 附加 `_testSearch` 来源标记，原请求未携带此字段。旧 `v2` 把输出来源误当作原始输入比较，因此请求键过期后重用失败。失败调用没有业务写入。

迁移 `20261021023200_ai_claim_search_annotation.sql` 仅在已完成的 `crm_search_query_v2` 任务上，且核实 `_testSearch` 内容及 `public.crm_test_records` 中 `ai_audit` 来源后，把该输出标记从比较用上下文中剔除。输入快照、操作者、其他任务类型、额外调用参数与并发锁保持原校验；由调用者传入标记仍拒绝。迁移只替换 `public.crm_ai_claim_v2`，权限继续仅供 `service_role` 执行；同版本 rollback 恢复旧函数，不删除审计数据。CloudBase 迁移任务最终状态为 `Succeed`，迁移记录版本为 `20261021023200`。管理工具的首次即时回执曾显示 `MIGRATION_NOT_APPLIED`，随后任务状态、函数定义和迁移记录均确认成功，未重复应用。

`tests/pc33/ai-claim-search-annotation.sql` 在事务回滚内覆盖旧虚构任务 #67 合法重试、改输入/伪造标记拒绝、处理中请求限制及非搜索任务拒绝；既有 PC33 审计与并发回归通过。HTTP 诊断隔离测试 2/2，PC24/25 与 PC33 专项 27/27，旧业务回归 108 PASS / 0 FAIL / 5 既定 SKIP。WP01 最终 `PASS_WITH_LIMITATIONS`：`public` 目录 1036 项、匿名探针 71/71、WP04 身份覆盖与 PC34 权限/双语页面通过。登录摘要已过期、通用门禁未代替真实服务角色写探针和移动端验收。

仅 `assistant` 云函数已部署；生产虚构搜索任务 #83 于 10:36 完成，模型解析保留朋友关系及互动暖客条件。用户在第二张搜索卡复核只显示 Person #784、来源为 `public.relationships #8` 与 `public.recruit_candidates #19`，且没有原始 JSON 或未翻译的 `search_v2_condition_followupMonths`。该调用只读业务记录，产生正常 AI 审计。发布提交、标签与最终三端核对见本轮发布记录。
