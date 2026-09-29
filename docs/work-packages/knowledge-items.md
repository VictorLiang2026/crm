# Knowledge Items 数据底座

基线：`a4abf1735afd1a7bca29559408899671d70f67ae` / `release-20260930-062755`。修改前本地、GitHub `master`、线上 `admin.html` 以及 27 个 CRM 云函数、129 个源码/配置文件一致。仅操作生产环境 `crm-d1gkae8ddc930d151` 的 `public` schema。

新增 `public.knowledge_items`，不修改现有表、视图、云函数、页面或路由。`item_type` 限定为 `product`、`policy`、`company`、`evidence`、`case`、`story`、`regulation`、`personal_experience`。字段包括 `id`、`source`、`source_date`、`valid_from`、`valid_to`、`verified`、`confidence`、`content`、`metadata`、`created_at`；其中日期均为 `date`，`valid_to` 按包含当天理解。`source` 和 `content` 不得为空，`confidence` 可空且非空时限于 0–1，`metadata` 必须是 JSON 对象，`verified` 默认为 false。验证状态与置信度独立；本轮没有 AI 自动写入或核实流程。

[Migration](../../cloudbase/migrations/20260929230400_knowledge_items.sql) 已通过 CloudBase 版本化迁移应用（版本 `20260929230400`，任务 `task-39e2153b`，状态 `Succeed`）。[Rollback](../../cloudbase/rollbacks/20260929230400_knowledge_items.sql) 只在表为空且无依赖时允许移除新表；若以后录入了知识数据，会拒绝删除，须先单独评估数据影响。

新表启用并强制执行 RLS。仅 `service_role` 有 SELECT、INSERT、UPDATE 授权和对应策略；`anon`、`authenticated` 无表授权；服务端角色无 DELETE 授权。没有新增浏览器直连、密钥或云函数。未来接入写入流程时仍需独立设计来源核实与人工确认，不能因为 `verified` 字段存在就把 AI 结果自动标为已核实。

线上只读验收：表存在且 0 行，11 个字段、2 个辅助索引、7 个约束和 3 条服务端 RLS 策略与迁移一致；迁移历史的最新版本为 `20260929230400`。授权目录仅显示服务端角色的读、新增、更新权限（表所有者保留固有权限）。[只读核查 SQL](../../tests/knowledge/verify-public.sql) 已入库。没有为测试创建或删除线上知识记录。

旧功能隔离回归：82 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、跟进、机会、Today、活动、招募和回收站。由于本轮仅新增尚未被业务代码引用的表，云端页面和函数产物无需重新部署；发布前后继续核对其源码一致性。实际知识录入与查询页面不在本工作包范围。
