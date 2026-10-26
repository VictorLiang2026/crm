# 招募目录人物候选人来源去重（2026-10-26）

## 范围与影响

- 招募目录的客户关联来源只读取 `customer_id IS NOT NULL` 的有效候选人；人物专属来源继续从 `v_recruit_candidates_person_only` 读取。
- 两个来源互斥，防止人物专属候选人同时出现在 `v_recruit_candidates` 与 Person-only 视图中。
- 只改 `person_360` 的招募目录查询；不改旧视图、数据库结构、权限、候选人软删除/恢复流程或身份唯一索引。

## 数据关系核验（线上 public schema，只读）

- `customers.person_id` 非空、唯一，外键指向 `persons.id`；每条客户扩展记录关联一个 Person。
- `recruit_candidates.person_id` 非空并外键指向 `persons.id`；`customer_id` 可空并外键指向 `customers.Id`，支持尚无客户记录的 Person-only 候选人。
- 招募表存在两个等价的活跃候选人唯一索引，均为 `UNIQUE (person_id) WHERE deleted_at IS NULL`；线上聚合没有发现同一 Person 多条有效候选人记录。
- 线上候选人 `580` 在两个视图中都出现，但基表只有一条有效行；两个视图合并时共发现 3 条重复行。
- 删除/恢复 RPC 软删除和恢复 `deleted_at`；有效视图过滤软删除行，恢复后重新进入有效候选人查询。

## 验证

- 改前全量 `sync-check.ps1` 通过：GitHub、页面/84 个可达模块与 29 个云函数（214 份源码/配置）一致；`person_360` 在改动前已核对。
- `npm run test:pc31`：12 项通过，0 失败；新增覆盖游标页与筛选页两个来源的互斥。
- `npm run test:pc35`：12 项通过；`node --test tests/wp071/identity.test.cjs`：7 项通过，覆盖软删回收与 Person-only 恢复入口。
- `npm run test:wp01`：发布门禁 `PASS_WITH_LIMITATIONS`；catalog 1122 项检查通过，WP04 身份审计通过（3 条已登记待确认身份例外），服务角色只读、76 项匿名检查与 108 项隔离回归通过。登录、生产写入及移动端仍标记未验证。
- 部署后再次运行 `npm run test:pc31`：12 项通过，0 失败。`person_360` 已按共享副本哈希校验后部署。
- 不使用真实客户或候选人做写入验证；数据库核验仅执行 public schema 只读查询。
- 本次没有真实数据写入；回归包含候选人列表与回收站恢复。
- 2026-10-27 00:22 采集时，WP01 曾因 5 个知识库对象尚未进入安全基线而阻断。知识库工作包随后独立发布并更新安全基线；06:43 重新采集生产 `public` 目录后，本包 WP01 门禁恢复 `PASS_WITH_LIMITATIONS`（目录 1149 项、匿名 77/77、隔离回归 108/0/5）。真实账号登录及生产写入仍未验证。

## 回滚

- 回滚发布提交并只重新部署旧版 `person_360` 云函数。
- 无数据库迁移或权限变更，无需数据库回滚。
