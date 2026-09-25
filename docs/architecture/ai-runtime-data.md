# AI Runtime 数据底座

本阶段仅新增 `public.ai_tasks`、`public.ai_runs`、`public.ai_results`。现有 `public.ai_recommendations`、页面、云函数和模型选择逻辑均不变。三层关系为任务 → 一次或多次执行 → 一次执行的一个或多个候选结果。`ai_results(run_id, task_id)` 的复合外键确保结果不能指向另一任务的执行；外键使用 `RESTRICT`，避免删除任务时静默清除审计记录。

`ai_tasks` 保存任务类型、可选技能/能力、可选业务主体与输入/上下文快照。多态 `subject_id` 使用 text，以兼容当前 bigint ID 与未来其他 ID 类型，不对其他业务表建立跨表外键。`status` 是文本，初始为 `pending`；`completed_at` 表示运行处理完成，不表示用户批准。`requires_confirmation` 默认 true。

`ai_runs` 的 `provider`、`model`、token 数、耗时、成功状态、错误与 `cost numeric(18,8)` 均允许为空，且无厂商或模型默认值。未来写入者只能记录实际返回或可靠测得的值，不得用猜测填充；成本单位需要在未来调用契约中明确。`ai_results` 保存原始候选、排序、推荐标记、用户选择/编辑与最终 JSON。约束禁止在未选择时写入最终 JSON、禁止编辑标记没有最终 JSON；这些字段本身不能证明操作者身份，真正的业务写入仍须由后续功能完成用户确认。

三表启用 RLS，仅 `service_role` 获得表和 identity 序列权限；`anon`、`authenticated` 与 `PUBLIC` 均无授权。`service_role` 策略显式声明后台访问边界，但该角色本身有 BYPASSRLS，密钥绝不能进入浏览器。本阶段没有云函数写入这些表。未来如需使用当前云函数的匿名 RDB 通道，须另行设计、验证并授权最小范围访问，不能直接放开快照表的匿名 CRUD。

索引支持按状态/时间查任务、按主体追溯任务、按任务追溯执行、按任务排序结果，以及查找人工选择结果。migration 为 `20260925111200_ai_runtime_foundation`；配套 rollback 先独占锁定三表并验证全部为空，有任何记录时拒绝删除。本阶段不执行 rollback 演练，避免清除线上数据。
