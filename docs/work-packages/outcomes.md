# Outcomes 数据底座

基线：`01011e7777d35800acf05423fa5ebcad10ae71d3` / `release-20260930-083048`。修改前本地、GitHub、线上页面和 27 个 CRM 云函数（129 个源码/配置文件）一致。本轮仅新增 `public.outcomes`，不改现有表、视图、云函数、路由或页面。

`outcomes` 记录已发生的结果，包含 `outcome_type`、`result`、`sentiment`、`relationship_change`、`opportunity_change`、`business_value`、`notes`、`occurred_at`，以及 `id`、`created_at`。可用 `action_id`、`opportunity_id`、`interaction_id`、`activity_id`、`recruit_candidate_id` 关联现有五类对象；允许多个关联同时存在，也允许不关联对象，以便记录独立结果。所有外键仅指向 `public`。被关联对象硬删除时使用 `ON DELETE SET NULL`，保留结果记录并延续原有删除行为；软删除不改变关联。结果表自身不提供 DELETE 授权。

`business_value` 为可空 `numeric(18,2)`，不隐含币种或收益定义；负值允许用于记录损失。文本字段限制长度，但不预设异议、情感或变化的业务枚举，避免臆定旧系统语义。按时间和五个关联键建立查询索引。

新表启用并强制 RLS，仅 `service_role` 具有 SELECT、INSERT、UPDATE 权限；`anon`、`authenticated` 不可直接读写。迁移与回滚分别见 `cloudbase/migrations/20260930011500_outcomes.sql`、`cloudbase/rollbacks/20260930011500_outcomes.sql`。回滚仅在表为空且无依赖时执行，避免删除已记录结果。没有新增密钥或线上业务入口。

版本化迁移 `20260930011500` 经预检为唯一待执行项，线上任务 `task-996bb26c` 状态 Succeed；迁移 SQL 在既定本地第二备份目录的 SHA-256 一致。线上只读验收确认表为 0 行、15 个字段、五个 `ON DELETE SET NULL` 外键、7 个索引（含主键）、RLS 启用且强制、三条仅对 `service_role` 生效的策略。实际表授权仅 `service_role` 拥有 SELECT、INSERT、UPDATE；`anon` 与 `authenticated` 的 SELECT 和序列 USAGE 均为 false。没有创建或删除任何测试客户数据。

CloudBase PostgreSQL 代码审查检查了表存在性与 RLS 覆盖；本轮没有文件上传或新前端。完整旧功能回归 82 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、机会、活动、招募和回收站。线上页面与云函数源码本轮未变；真实创建结果的写入流程尚未开发，因此没有在线结果录入业务测试。

发布标签拟定为 `release-20260930-093011`；Git 发布脚本会在提交前后核对本地、GitHub 与云端源码。
