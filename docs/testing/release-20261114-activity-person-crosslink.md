# 活动参与者与人物双向关联

## 目标与影响范围

落实已审阅方案：活动名单导入与 Person 建档保持独立管理，能够确认同一身份时再建立关联。

- 活动名单导入：唯一精确姓名匹配且输入无重复时默认选择复用；重复姓名、括号外同名或候选不唯一时显示醒目提示并要求人工选择。没有匹配到 Person 的参与者只进活动花名册，不自动创建 Person。
- 新建 Person：服务端列出未关联的活动花名册档案及活动历史。唯一精确候选可默认选择，多个或非精确候选需人工判断；预览后确认才建立关联。仅补入 Person 中空白的电话、微信、机构、学校等基础字段，不覆盖已填信息，也不复制活动专属信息。
- Person 批量导入：存在未关联活动档案时要求人工确认关联或只创建 Person；名单中明示新身份时也可单独选择花名册档案关联。服务端复核档案版本与身份，并由单个数据库事务写入 Person、花名册和活动参与关系。
- 不改变 Legacy Quick Capture 行为；保留已有路由、表/函数及独立活动人员管理能力。仅新增/扩展 `public` 数据库函数；新增的 identity 执行 RPC 明确加入安全目录基线，仅 `service_role` 可执行，anon/authenticated 均不可执行。

## 发布与回滚

数据库迁移按以下顺序发布，回滚按逆序执行：

1. `20261114143200_activity_person_bidirectional_link.sql`：让花名册导入创建独立参与者；新增受服务角色保护的 Person 创建及花名册原子关联 RPC。对应 `.rollback.sql` 恢复旧函数并移除新增 RPC。
2. `20261114154600_person_list_transfer_activity_roster_link.sql`：扩展批量人物导入 RPC，支持经人工确认后将新 Person 与现有活动档案原子关联。对应 `.rollback.sql` 恢复原 RPC。

迁移文件和 rollback 均同步存于仓库 `cloudbase/migrations/` 及 `C:\Users\victor\cloudbase\migrations`。执行数据库 rollback 前须先回退云函数/静态模块，避免新代码继续调用已移除的 RPC。

本轮云端发布范围：`public` 数据库两项迁移、`person_360` 云函数、`activity-roster.js`、`person-list-transfer.js`、`write.js`、`i18n.js` 四个静态模块。未涉及 `admin.html`、其他函数或其他 schema。

## 回归结果

- 花名册、Person 转移、身份预览与数据库迁移专项：31 项通过；相关独立导入、唯一精确匹配预选、歧义人工确认、空字段补全、事务关联、旧输入兼容、版本冲突与幂等重放均覆盖。
- WP01：`PASS_WITH_LIMITATIONS`；隔离回归 102 项通过、0 失败、5 项既有跳过；public catalog 1,551 项检查通过（86 表、20 视图、41 序列、109 函数）；WP04 身份覆盖客户 785/785、参与者 6/6、增员 573/573、嘉宾 6/6，异常 0；匿名只读探针 106/106 通过；PC34 服务角色只读检查通过。
- 两项 `tests/wp071/qualified-name.browser.cjs` 旧浏览器用例仍在独立运行时失败（第一次姓名确认用例在重复 DOM 查询时找不到按钮，Quick Capture 用例遇到 CDP inspected target 导航/关闭）。WP01 主回归和本轮新增的活动名单浏览器回归通过；以上两项失败未归因于本轮代码，也未修改其既有行为。真实登录、生产写入和真机验收仍按 WP01 标为未验证。
- 首次应用候选版本 `20261114143000` 因函数定义末尾缺少分号失败；平台任务确认迁移未生效。修正版本 `20261114143200` 已应用并登记，远端检查确认名单函数和新增 identity RPC 存在。
- 批量导入迁移候选版本 `20261114154500` 因 DO 块分隔符错误失败；平台任务确认该版本未应用。修正版本 `20261114154600` 已登记，远端迁移详情与 `public.crm_person_list_transfer_create_v1` 更新指纹确认发布成功。MCP 首次响应误报 `verified=false`，随后 read-only `migrationDetail` 和函数指纹确认目标版本已生效。
- `person_360` 已部署；`activity-roster.js`、`person-list-transfer.js`、`write.js`、`i18n.js` 四个模块已逐文件上传。静态校验确认 103 个可达页面资源一致；云函数只读核对确认 30 个函数的 336 个源码/配置文件一致。
- 迁移后重新采集的 public catalog 发现新增 identity 执行 RPC，已按仅 `service_role` 可执行的权限更新安全基线；最终 WP01 对该快照复核无漂移、无阻断。
- 业务发布提交：`941b946a25cdb05febbeb52f35bd091b9a5cbf02`；发布标签：`release-20261114-1031`。GitHub `master`、标签及本地 HEAD 相同。
- 发布后 `sync-check.ps1` 通过：线上 admin.html SHA-256 一致、103 个页面可达资源一致、30 个云函数的 336 个源码/配置文件一致。该记录更正属于文档更新，未改变业务云端产物。

