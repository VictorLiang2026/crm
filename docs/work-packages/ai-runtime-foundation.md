# AI Runtime 数据底座工作包

基线提交与回滚标签：`22a46f76ff55dd8e311e05c931dafc0ff034668f` / `release-20260925-152612`。本工作包仅新增 `public.ai_tasks`、`public.ai_runs`、`public.ai_results`，不接入现有页面或云函数，不更改 `public.ai_recommendations`。

## 交付

- Migration：`cloudbase/migrations/20260925111200_ai_runtime_foundation.sql`，已在生产 CloudBase 环境 `crm-d1gkae8ddc930d151` 应用，迁移任务 `task-83ab53c8` 成功，远端迁移内容与本地文件一致。
- Rollback：`cloudbase/rollbacks/20260925111200_ai_runtime_foundation.sql`，只允许三张表全空时逆序删除；有记录就报错，不执行级联删除。未在线上执行回滚。
- 只读核验脚本：`tests/ai-runtime/verify-public.sql`；设计说明：`docs/architecture/ai-runtime-data.md`。

## 线上核验与权限

迁移前目标三表均不存在，迁移后均存在且为空；`public` 表数从 19 增至 22。列类型、非空约束、默认值、三表关系、六个业务索引和三张表的 RLS 均与迁移一致。`ai_results(run_id, task_id)` 通过复合外键限定结果只能指向同一任务的执行。

三张表只有 `service_role` 获得表权限和 identity 序列权限；`anon`、`authenticated`、`PUBLIC` 没有授权。每表有一条 `service_role` 策略。现有云函数的匿名 RDB 路径不能直接读写该数据底座，未来接入需单独设计和验证最小权限。迁移规划时自动审批拒绝向 `anon` 授予敏感快照、结果和反馈的完整 CRUD；已改用更窄的后台权限并重新规划、成功应用。

`public.ai_recommendations` 的列结构指纹在迁移前后相同：`b29168a4a5a3e481496b205f7780de52`。现有页面、路由、云函数和模型选择逻辑未变。新表没有测试或业务记录；本轮不进行写入或真实 AI 调用。

## 回归与剩余边界

`npm test`：57 PASS / 0 FAIL / 5 SKIP。数据库的列、RLS、权限、索引、外键及空表状态使用只读查询核验。未验证未来写入服务的端到端权限、真实 AI 调用、成本单位与人工确认流程；这些属于后续接入工作包。`requires_confirmation` 默认 true，结果标记和 `completed_at` 本身不能代替人的确认。

发布核验：本轮标签 `release-20260925-195101`。云端页面 HTTP 200 且 SHA-256 与本地一致；26 个 CRM 云函数的 108 个源码/配置文件与本地一致，共享模块的 52 份副本哈希一致。云端页面和云函数源码本轮无需重新部署；数据库 migration 已在线上执行。GitHub 一致性由发布脚本在推送后再次验证。
