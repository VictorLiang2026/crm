# PC24 组合式 CRM 搜索设计

## 兼容边界

- 既有 `assistant` action `search`、`crm_search_parse` 1.0、`public.crm_search_people_v1(text,integer,integer)` 与三模板 UI 语义保持原样。
- Console 现有搜索页增加 PC24 请求路径；新请求使用独立 `searchV2` action、`crm_search_query_v2` Skill 和 `public.crm_search_people_v2(jsonb,integer,integer)`，旧调用者无需迁移。
- 新 RPC 固定使用 `public` 全限定对象，固定 SQL 分支和 service-role 权限；无动态 SQL、浏览器数据库权限或写操作。

## 请求流程

1. Authenticated assistant 收到自然语言 query；Gateway 用 CloudBase 当前模型配置解析为严格 JSON Schema。
2. 服务端验证恰好允许的条件字段、值、组合数量、月份、页码和每页上限。
3. 如果模型返回人物提及，服务端调用既有 `PersonService.resolveName()`。返回候选供人工选择；提交所选 ID 时再次解析并绑定到候选结果，不一致则拒绝。
4. 服务端把验证后的过滤条件传给固定只读 RPC。SQL 通过显式 `EXISTS`/`CTE` 和静态 WHERE 分支组合条件，分页和稳定排序均在数据库执行。
5. 服务器将来源引用交给已有测试数据披露服务，结果标记“测试/未核验”；不修改 AI 或 CRM 业务数据。

## 输出契约

```json
{
  "status": "complete",
  "criteria": {"filters": {}, "page": 1, "pageSize": 50},
  "total": 0,
  "rows": [{"personId": "1", "displayName": "...", "matchReasons": [], "sources": []}],
  "hasMore": false,
  "truncated": false,
  "timeZone": "Asia/Shanghai",
  "testData": {"containsTestData": false}
}
```

旧模板页面输出继续使用 `criteria.template/months` 与 `rows.person_id`，不做契约升级。

## 数据和安全

- 目标数据来自 `public.persons` 及有效源表；人物必须 `deleted_at IS NULL`。
- 角色按有效源表派生，避免依赖 `person_roles` 的历史 backfill 是否同步。
- Relationship 要求有效且 `status='confirmed'`、`confirmed_at IS NOT NULL`；端点必须存活。
- Fact 要求 `item_type='fact' AND confirmed=true`，`valid_from` 未到、`valid_to` 未过，并按最新验证/创建时点排序。冲突分类不作为单独事实命中。
- 活动只把实际 `attended` 记录算出席；邀请不算到场。
- 跟进、机会、候选人等记录只匹配未软删除行；时间按明确的 Asia/Shanghai 日期口径。
- 模型只输出枚举/过滤值与可选的原始姓名短语，不输出 SQL、Person/业务 ID 或结果名单。
- 证据数组只返回和有效筛选匹配的公开业务行；固定 50 条/页、最多 11 页，550 条以上返回 `truncated=true`。
- 新命令不访问 `pr` schema/对象/函数，也不新增索引；真实负载测量留给 PC31。

## 回归

- PC24：schema/过滤器拒绝、组合、分页稳定、来源引用、测试行标记、Person 歧义选择和纯读取。
- 相邻旧功能：旧 Search 三模板、Person 关系、家庭、活动出席、机会、招募阶段/跟进、保险相关旧搜索。
- 发布前通过 WP01 目录/RLS/匿名/旧路由门禁；真实服务端与真实登录探针若受 CloudBase 凭据阻挡须单列。
