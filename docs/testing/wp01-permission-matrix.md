# WP01 public 角色与视图矩阵

核验日期：2026-10-03（Asia/Shanghai）。每个对象均限定 public；下列为当前事实，不代表批准扩权。

授权列为目录中的有效权限；运行结果单列。service_role 具有 BYPASSRLS，本轮只验证目录授权，没有使用服务密钥执行运行时请求。authenticated 的 47 项是有效登录 JWT 的 HEAD 请求返回 403；匿名运行结果为无业务行可见或拒绝。未执行写入权限探针。

| public 对象 | 类型 | anon 授权 | 匿名实际读取 | authenticated 授权/实际 | service_role 授权/实际 |
| --- | --- | --- | --- | --- | --- |
| actions | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| activities | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| activity_participants | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| activity_speakers | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| activity_tasks | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| activity_topics | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| ai_recommendations | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| ai_recommendations_view | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| ai_results | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| ai_runs | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| ai_tasks | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| assistant_action_commands | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| commitments | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| context_items | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT / 未验证 |
| customers | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| customers_view | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| followups | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| followups_view | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| gifts | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| gifts_view | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| household_members | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| households | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| interactions | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| knowledge_items | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| learnings | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| ocr_records | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| opportunities | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| opportunity_candidates | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| outcomes | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| person_roles | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| persons | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| photos | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| photos_view | 视图（invoker） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| playbooks | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | INSERT, SELECT, UPDATE / 未验证 |
| policy_review_reports | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| products | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| products_view | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| recruit_candidates | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| recruit_followups | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| recruit_goal_benchmarks | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| recruit_goals | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| recruit_milestones | 表（RLS） | DELETE, INSERT, SELECT, UPDATE | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| relationships | 表（RLS） | 无 | 通过：denied | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| v_action_center | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| v_funnel_stats | 视图（invoker） | SELECT | 通过：fixed dimensions, zero aggregate metrics | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| v_recruit_candidates | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |
| v_recruit_candidates_trash | 视图（invoker） | SELECT | 通过：authorized, zero visible rows | 无 / 403 拒绝 | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE / 未验证 |

真实登录 getSession 与 customers.list 的虚构关键词空查询通过。这一允许路径证明现有登录云函数入口可调用，不证明函数内的数据库凭证是哪一种角色。

首次探针错误使用 search 参数，空结果断言失败，实际请求未按虚构关键词过滤（pageSize=1）；未保存返回行或客户内容、未写业务数据。核对源码后仅将测试参数改为 keyword，重新登录及全量只读探针通过。首次失败与重跑摘要均保留在 wp01-results.json。

