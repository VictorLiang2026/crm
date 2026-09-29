# 活动参与者 Person 映射（2026-09-29）

## 基线与范围

- 修改前 `master` / GitHub / 云端代码一致：`6a3d74bc3c1ca24a91efa38e30644de843697c75`，回滚标签 `release-20260929-075318`。
- 仅改 `public.activity_participants`、现有 `person_360` 函数和 `admin.html` 活动参与者入口；不触碰其他 schema、旧活动函数、旧路由或 AI 逻辑。
- 线上迁移前 15 条参与者，2 条有效。仅 1 条有效记录可通过旧客户 ID 确定 Person；1 条未映射。无依赖 `activity_participants` 的 public View。

## 行为与权限

- 新增可空 `canonical_person_id`，外键关联 `public.persons(id)`；同一活动的有效记录不能重复关联同一 Person。`person_type` 和 `person_id` 保持原值。
- 迁移仅回填有效且旧客户/候选人/嘉宾 ID 唯一确定的记录；不按姓名猜测，不回填历史软删除记录。迁移后有效记录仍为 2 条：已映射 1、未映射 1；历史软删除记录映射 0。
- 活动新增入口先调用服务端 `PersonService.resolveName()`，由人点选候选并确认；没有确定 Person 可进入原姓名搜索/暂存入口。旧活动参与者仍按原路由查看；仅没有旧 `person_id` 的 Person 参与者进入 Person 360。
- 新增写操作在 `person_360` 已登录函数内进行，使用原有仅服务端 API Key。函数逐项复核 Person 名称、活动和旧 ID，避免重复；旧 `activities.addParticipant` 接口不变。
- 原匿名函数通道仍可修改其旧字段，但数据库触发器禁止其新增或改写 `canonical_person_id`。`persons` 的 RLS 和原参与者 RLS 均保持不变。

## 迁移与恢复

- 应用：`cloudbase/migrations/20260929084000_activity_participants_canonical_person.sql`，远端迁移任务 `task-139957cd` 成功。首次尝试的函数语句解析失败，事务未生效；修正后按同版本重新计划并成功应用。
- 回滚：`cloudbase/rollbacks/20260929084000_activity_participants_canonical_person.sql`。执行前须先回退页面和函数，再评估新建 Person 参与者记录；回滚会移除其 canonical 关联，旧字段和软删除状态不变。未执行回滚。

## 验证与限制

- 隔离后端及浏览器回归：73 PASS、0 FAIL、5 SKIP；包括人工选择、同名复核、旧 ID 映射、Person-only、重复阻止、登录/客户/活动/增员/回收站。
- 线上数据库结构和映射数量只读核验通过；未向生产写入测试参与者。
- 生产写入接口的管理端验证请求被自动审批拦截，因为请求携带确认标记并可能写入真实数据；未绕过该拦截。后续可用明确标记的隔离测试活动与 Person，在真实登录会话中单独验证写入和回读。
- `person_360` 管理端只读调用返回 `UNAUTHORIZED`，说明无登录身份时未放行。
- 云端仅更新 `person_360` 代码和 `/crm/admin.html`；发布后需再次核对哈希、本地与 GitHub 一致性。
