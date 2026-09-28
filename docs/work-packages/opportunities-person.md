# Person 机会扩展（2026-09-29）

本轮在 `public.opportunities` 增加 `person_id`，保留 `customer_id` 与旧中文类型。迁移将当时的 6 条旧记录按 `persons.legacy_customer_id` 回填；6 条均为 2026-09-07 已软删除的旧记录，迁移后活跃机会仍为 0。新 Person 机会由 `person_360` 真实登录保护接口创建，`customer_id` 为空。八个英文类型为 insurance、recruit、referral、activity、speaker、partnership、service、relationship。旧客户机会云函数和详情页保持原有客户入口与中文类型；英文 referral 在 API 中使用原转介绍状态机。

权限：匿名机会通道的 RLS 新增 `customer_id IS NOT NULL` 条件；仅服务端 `service_role` 可读写 Person 专属行。双身份记录由复合外键确保客户与 Person 匹配，且至少要有一个身份。依赖视图 `v_action_center`、`v_funnel_stats` 已重建，保留 `security_invoker=true`，并明确只纳入有客户 ID 的机会。Action 关联守卫兼容 Person 专属机会，旧客户关联规则保留。

Person 360 模块增加机会卡片：显示活跃机会，旧客户机会链接到原详情页；Person 专属机会可人工创建和编辑。已删除记录不自动恢复。旧 Today、漏斗、客户机会页和回收站没有新增路由或数据来源。

数据库迁移：`20260928110000_opportunities_person`，CloudBase 任务 `task-e2efe557` 成功。本地 migration 与 rollback 成对保存；前向 migration 已按项目约定备份到本机 CloudBase 迁移目录。回滚先检查是否已有 `customer_id IS NULL` 的 Person 机会，有则拒绝回滚，避免丢数据。代码回滚需恢复本轮函数和两个静态文件的上一 Git 发布版本，不强推、不自动处理线上业务数据。

验证：迁移后线上读回字段、约束、2 条 RLS 策略、2 个视图的 invoker 设置与客户过滤均符合设计；旧 6 条 `person_id` 回填完整。离线完整回归 66 PASS / 0 FAIL / 5 SKIP；Person/Action 针对性 15 PASS。生产云函数只读调用中，旧机会列表返回空（与活跃数 0 一致），未登录 Person 360 调用返回 `UNAUTHORIZED`；测试账号独立窗口登录后，Person 与机会列表只读调用成功，机会数 0、无错误。两个静态文件线上 SHA-256 与本地一致。生产环境未执行新建/编辑机会写入测试；界面写操作仅通过隔离浏览器 fixture 和服务端单元测试验证，不把真实客户当测试数据。

Codex 自动审批曾间歇性返回来自 `chatgpt.com/backend-api/codex/responses` 的 403 网页；受控操作原路径重试成功。该故障属于开发工具链，不是 CRM 响应；若再次持续发生，停止受影响操作，不绕过审批。
