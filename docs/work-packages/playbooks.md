# Conversation Playbook 数据底座

基线：`18a66c91098f21c73bd6b304337731228365fb19` / `release-20260930-071011`。修改前本地、GitHub `master`、线上入口页面及 27 个 CRM 云函数（129 个源码/配置文件）一致。生产环境 `crm-d1gkae8ddc930d151`，仅操作 `public` schema。

新增 `public.playbooks`，保存 `scenario`、`objection`、`possible_underlying_reasons`、`clarifying_questions`、`response_logic`、`evidence_refs`、`case_refs`、`story_refs`、`do_not_say`、`next_objective`，另有 `id` 和 `created_at`。`scenario`、`response_logic`、`next_objective` 必填；`objection` 可空，以支持没有明确异议的主动沟通场景。原因、澄清问题、禁用说法使用文本数组；三类引用使用正整数 ID 数组，分别意图指向 `public.knowledge_items` 的 `evidence`、`case`、`story` 条目。数组默认空，禁止空 ID、非正 ID 和多维数组。

引用数组不是逐项外键。数据库只约束其形状和 ID 值，不保证每个 ID 当前存在、仍属于预期类型、已核实或处于有效期内。未来接入 Conversation Playbook 读取或写入服务时，必须在服务端解析并校验这些条件；不得把未经核验的引用直接作为可信证据。当前 `knowledge_items` 和 `playbooks` 均为空，未创建线上测试记录。

[Migration](../../cloudbase/migrations/20260929234300_playbooks.sql) 已通过 CloudBase 版本化迁移应用（版本 `20260929234300`，任务 `task-bc56e32a`，状态 `Succeed`）。[Rollback](../../cloudbase/rollbacks/20260929234300_playbooks.sql) 仅在表为空且没有依赖时移除新表；已有 Playbook 内容时拒绝删除，避免丢失业务数据。没有改变 `knowledge_items` 或其他旧对象。

新表启用并强制执行 RLS，只有 `service_role` 拥有 SELECT、INSERT、UPDATE 授权和对应策略；`anon`、`authenticated` 无表权限，服务端角色也未获 DELETE 授权。没有新增密钥、云函数、页面、路由或模型选择逻辑。现有 `conversation_playbook` Skill 契约与 `meeting_prep` 的 `relevant_playbook` 暂不可用状态保持不变；本轮只建立存储结构。

线上只读验收：`playbooks` 存在且 0 行，12 个字段、8 项约束、3 条服务端 RLS 策略与迁移一致，迁移历史最新版本为 `20260929234300`。[只读核查 SQL](../../tests/playbooks/verify-public.sql) 已入库。Skill Registry 6 PASS / 0 FAIL；完整旧功能隔离回归 82 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、跟进、机会、Today、活动、招募和回收站。因业务产物未改变，页面与云函数无需部署；发布前后核对云端源码一致性。
