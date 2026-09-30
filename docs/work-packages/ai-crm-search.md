# AI CRM Search 工作包

日期：2026-09-30。基线：`46d436d52c602d197c7cf539d8095dff971dbe00`，`release-20260930-204144`。

## 变更与边界

- 新增 `#/ai/search` 模块页面、`assistant` 的显式 `action=search`、`crm_search_parse` Skill。现有七种 assistant Intent Router 契约和旧页面入口保持兼容。
- CloudBase AI Gateway 只把用户问题和三个固定模板的说明交给模型；模型仅输出模板及 1–12 个月的时间窗口。人物、数量、来源与时间由数据库计算。无法归入模板的问题返回不支持，不拼接或执行模型生成的 SQL。
- `public.crm_search_people_v1` 是只读、安全调用者权限的固定模板函数。仅 `service_role` 可执行；`anon` 和 `authenticated` 无执行权。迁移为 `cloudbase/migrations/20260930133700_ai_crm_search.sql`，手动 rollback 为 `cloudbase/rollbacks/20260930133700_ai_crm_search.sql`。
- `assistant` 通过既有真实登录门槛访问，数据库 API Key 仅存其服务端配置；权限范围仍由 RLS 与函数授权限定。CloudBase 模型由环境配置选择，代码没有厂商或模型名。
- 不修改客户、活动、招募、关系、家庭或保险业务记录；AI 运行审计仍写入 `ai_tasks`、`ai_runs`、`ai_results`。

## 查询口径

1. 活动未跟进：只计 `status=attended` 的实际到场；按 canonical Person 或明确的旧 ID 关联，排除到场后的客户/招募跟进及互动。邀请不算到场。
2. 子女教育未见保险记录：要求人工确认的家庭成员关系与最近教育来源；检查当前 CRM 已记录的跟进、互动、Fact、保单检视及产品。结果表示“记录中未见”，不能证明现实中从未谈过保险。
3. 重点客户关系下降：要求客户优先级 A/B 和最近明确记录的下降趋势，不根据备注或 AI 推测关系变化。

每条结果含 Person ID、显示名及可追溯来源 ID/日期，最多返回 30 人。页面只展示数据库结果，使用 `textContent` 呈现字段，Person 链接进入原有 Person 360。

## 验证

- 迁移线上执行成功；只读核验函数存在、`SECURITY INVOKER`，实际授权为 `anon=false`、`authenticated=false`、`service_role=true`。
- 线上三模板只读查询均返回 0 人。核验时活动有效参与者仅为已邀请，已确认子女关系和下降趋势来源均为空；因此没有正例生产数据可用于端到端命中验证，也没有为测试伪造客户记录。
- 本地 Skill/assistant 测试通过 16/16；AI Gateway 回归 14/14；模块前端检查通过。完整离线回归 83 PASS / 0 FAIL / 5 SKIP，覆盖登录、客户、跟进、机会、Today、漏斗、活动、招募和回收站，以及新路由入口。
- 云端 `assistant` 和三个静态文件已精准部署；28 个 CRM 函数的 138 个源码/配置文件逐项匹配，三个静态文件 HTTP 200 且 SHA-256 与本地一致。
- 仍需真实登录验证：线上执行一次搜索和旧 assistant 路由；模型调用可能消耗 CloudBase 套餐资源点。生产正例需等真实数据自然形成或使用隔离的明确测试记录另行验证。

## 发布与回滚

仅部署 `assistant` 函数及 `/crm/admin.html`、`/crm/js/modules/ai-crm-search.js`、`/crm/css/ai-crm-search.css`。回退代码应从本轮前的 Git 标签恢复这四个产物；数据库函数按 rollback 单独评估并执行，避免影响正在使用的新入口。服务端 Key 的停用须在确认没有调用者后独立进行。
