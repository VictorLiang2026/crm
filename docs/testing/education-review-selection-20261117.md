# 教育资料补全审核选择改进

日期：2026-11-17  
环境：`crm-d1gkae8ddc930d151`  
迁移：`20261117231025_person_education_review_selection`

## 本轮范围

- 教育补全批次支持按最新入库时间选择指定条数、按 Person 姓名或 ID 搜索并多选；顺序为 `created_at DESC, id DESC`，默认 50 人，批次仍受服务端 1500 人上限保护。
- 唯一且符合既有资格规则的教育经历默认选中。字段为空时默认采纳识别结果；已有值默认保留，值相同时不产生变更；用户可以逐字段改用识别值，或输入人工修订值。
- 识别结果不像学校/专业名称时显示提示，但不阻止人工审核。所有变更继续经过服务端 Preview 和人工 Confirm，页面不直接写 Person 数据。
- 隐藏低价值的计划术语，将“检查并预览”作为主操作，只有有可撤销记录时显示“撤销所选回填”。提供中文、英文和 iPad 布局。
- `public.crm_education_backfill_v1` 新增 `people` 查询与逐字段 `keep/candidate/manual` 审核动作；不改写既有批次及人物资料。迁移提供对应 rollback 文件。

## 部署与线上核验

- CloudBase 数据库最新迁移：`20261117231025`；`migrationDetail` 返回此迁移，`listMigrations` 共 206 条且最新版本为此版本。
- 只读验证：`public.crm_education_backfill_v1` 包含 `people` 及逐字段审核逻辑；`service_role` 有执行权限，`anon` 与 `authenticated` 无执行权限。
- 已部署 CloudBase `assistant` 函数。
- 已上传 `/crm/admin.html`、`/crm/js/modules/console/education-backfill.js`、`/crm/js/modules/console/i18n.js`、`/crm/css/education-backfill.css`。
- 上传后 `tests/wp01/static.cjs` 通过：页面可达的 107 个 JS/CSS 资源与云端匹配，线上 `admin.html` HTTP 200 且哈希匹配。
- `tools/sync-check.ps1 -CloudOnly` 通过：30 个函数、340 个源码/配置文件匹配，含 `assistant`。

## 回归结果

- 教育流程回归：28/28 通过，覆盖双语 iPad 选择、搜索、审核确认、回滚、并发/过期预览、资格边界和真实 SQL 事务夹具。
- WP04 身份审计：通过；4 类记录覆盖关系无新增例外。WP04 夹具 8/8 通过。
- WP01：`PASS_WITH_LIMITATIONS`，基础门槛无阻断项；隔离 regression 102 项通过、5 项历史预设跳过；匿名探针 113/113 通过。发布门禁明确保留“需人工登录”、生产 service runtime、真实生产写操作和手机验收未验证。此模块按项目要求只验收 iPad。
- 未对真实 Person 数据执行 AI 识别、创建或更新；识别及写入流程仅在隔离夹具中验证，重要变更仍需人工确认。

## 回退

数据库回退脚本：`cloudbase/migrations/20261117231025_person_education_review_selection.rollback.sql`。本迁移只替换既有 RPC 函数定义，没有批量写入 Person 或新增批次。发布后如需回退，先核对迁移历史及是否已有新格式批次，再评估执行 rollback；不要直接删除业务数据。
