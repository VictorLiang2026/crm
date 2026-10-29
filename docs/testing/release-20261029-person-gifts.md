# WP02 人物伴手礼归属发布记录

日期：2026-10-29  
范围：新系统 Person 360 的伴手礼；旧 `admin.html` 客户礼品流程保持兼容。只操作 `public` schema，不改动任何 `pr` 对象。

## 变更

- `public.gifts.person_id` 成为必填的主归属；旧 `customer_id` 保留并改为可空，供没有客户角色的人物存放伴手礼。已存在的 189 条记录均回填到有效 Person，核对结果：缺少人物 0、无效人物 0、客户/人物不匹配 0。
- 新系统人物资料页按 Person ID 读取、新增、编辑和删除伴手礼。没有客户角色的人物也能记录伴手礼；照片和附件仍要求客户关联，不改变其现有存储与访问路径。
- 旧云函数调用只提供 `customer_id` 时，服务端解析客户关联人物并写入两个 ID；旧 Admin 编辑和无作用域删除请求的兼容行为保留。
- 五个依赖 `gifts` 的 public views 追加 `gift_person_id`，保留原列顺序及现有 grants/owner。人物删除预览增加伴手礼数量；仅有 Person 关联的礼品随人物批次软删除，恢复时按同一批次恢复。
- 回滚文件会先恢复原视图和人物删除函数。只有全部礼品仍可映射回客户时才允许删除新列；若出现人物专属礼品或客户/人物映射变化，回滚明确拒绝以免丢失归属。

## 数据库迁移和线上核对

- 已应用 `20261029121100_gifts_person_ownership` 与 `20261029121200_gifts_views_invoker_security`，均有配对 rollback 文件。
- CloudBase 的 `applyMigration` 两次都出现 `MIGRATION_NOT_APPLIED` / `verified=false`，但任务状态为 `Succeed`。没有重放迁移；随后只读核对确认远端迁移清单总数为 136、最新版本为 `20261029121200`，两个版本的 `migrationDetail` 均存在，实际列、视图定义、人物回收站函数与迁移内容相符。
- 第一次 `CREATE OR REPLACE VIEW` 意外重置五个 view 的 `security_invoker` 选项。安全目录门槛检测到差异并阻止发布；追加第二个迁移恢复五个 view 的 `security_invoker=true`。之后新鲜 catalog 检查 1166 项、失败 0，77 项匿名访问检查全部通过。
- 线上五个 view 的 `security_invoker=true`，grants 与发布前一致。人物礼品服务已用不存在的 Person ID 进行只读分页探测，返回空结果和正确分页字段；没有真实客户数据写入。

## 回归和发布

- `npm run test:pc11`：4/4 通过；覆盖客户 ID 兼容、人物归属写入、Person-only 礼品与双语 iPad 页面。
- `npm run test:pc35`：12/12 通过；覆盖人物删除预览、回收站及恢复边界。
- `npm run test:modular`：通过。
- `npm run test:wp01`：release gate `PASS_WITH_LIMITATIONS`；安全夹具、WP02-WP06 fixtures、匿名入口和完整隔离回归均通过；回归 108 通过、0 失败、5 项历史跳过。遗留未验证项：真实登录、service-role 写入运行时、真实 CRUD/恢复、手机验收。
- 仅部署云函数 `gifts`；静态托管仅上传 `care-materials.js`、`data.js`、`i18n.js`、`write.js`。`sync-check.ps1 -CloudOnly` 核验 admin 页面、90 个引用资源和 29 个 CRM 云函数（228 个源/配置文件）与线上一致。
- 未执行任何真实客户的创建、更新、删除、人物回收站或外发操作。

## 回滚

按逆序回滚 `20261029121200`、再回滚 `20261029121100`；第二个迁移的 rollback 会保留安全的 `security_invoker=true`。如果新增了人物专属礼品，WP02 rollback 会主动停止，需先制定保留这些记录的迁移方案。应用旧版 `gifts` 云函数和四个静态资源时，必须一并恢复兼容版本，并重新执行回归与线上核对。
