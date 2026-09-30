# Learnings 数据底座

基线：`f5b1bd32ac173a8cc5f74559c8eef3c103476d00` / `release-20260930-093011`。修改前本地、GitHub、线上页面和 27 个 CRM 云函数（129 个源码/配置文件）一致；`public.learnings` 不存在。本轮仅新增 `public` 表、守卫函数和索引，不改已有表、页面、云函数、路由或 AI 模型配置。

来源以 `source_type` 区分 `ai_recommendation`、`user_correction`、`action`、`outcome`。`source_table` / `source_id` 对 AI 建议支持 `public.ai_recommendations` 和 `public.ai_results`，对 Action、Outcome 分别限定 `public.actions`、`public.outcomes`；人工修正不要求已有来源表。它们是受限的软引用，本轮没有新写入服务，未来写入端必须验证来源记录真实存在、属于当前授权范围，并决定如何处理来源删除；不对旧表增加外键或改变删除行为。

主体字段为 `situation`、`ai_recommendation`、`user_decision`、`actual_action`、`outcome`、`learning`、`confidence`、`scope`。`situation` 与 `learning` 必填；其余叙述可留空以支持待补充草稿。`confidence` 可空且限制在 0–1；`scope` 默认为 `private`，文本值本身不授予跨用户或全局复用权限。附加 `id`、`created_at`、`confirmed`、`confirmed_by_uid`、`confirmed_at`，为人工确认留审计位置。

新记录只能先以 `confirmed=false` 插入；数据库守卫拒绝插入即确认，并禁止修改来源标记。后续确认必须记录非空 `user_decision`、确认者 UID 与时间。未来服务仍须核验真实登录身份；表内 UID 不能独自证明有人确认。未经确认的 Learning 不应供 AI 作为已验证经验使用。本轮不开发自动学习、检索、页面或模型调用。

新表强制 RLS，仅 `service_role` 拥有 SELECT、INSERT、UPDATE 与相应策略；不给匿名、认证用户或服务角色 DELETE 权限。版本化 [migration](../../cloudbase/migrations/20260930030500_learnings.sql) 与 [rollback](../../cloudbase/rollbacks/20260930030500_learnings.sql) 成对提供。回滚仅在表为空且无依赖时执行，防止删除真实 Learning。线上只读验证见 [SQL](../../tests/learnings/verify-public.sql)。

迁移 `20260930030500` 预检显示唯一待执行项且无冲突；线上任务 `task-9b2d00c1` 状态 Succeed，本地迁移文件与既定第二备份目录 SHA-256 一致。CloudBase 管理端会话过期后重新授权，未重复执行迁移。线上只读核验确认 0 行、16 字段、3 个索引（含主键）、触发器已启用、来源与确认 CHECK 约束符合迁移。表 RLS 启用且强制；仅有三条 `service_role` 策略及 SELECT、INSERT、UPDATE 授权，`anon`/`authenticated` SELECT 与序列 USAGE 均为 false。未写入线上测试记录，触发器拒绝路径未作生产写入测试。

完整旧功能回归 82 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、机会、活动、招募和回收站；页面与云函数源码本轮未变。发布标签拟定为 `release-20260930-114944`，Git 发布前后会核对线上源码与 GitHub 一致。
