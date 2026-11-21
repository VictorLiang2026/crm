# 每日激励语库批量导入发布记录（2026-11-21）

## 变更范围

- 每日激励语管理页增加双语 JSON v1 导入：文件预览新增项、重复项、已有空推荐值补齐及自动评分项；只有点击确认后才写入。
- `assistant` 增加批量导入及缺分补齐服务端入口；服务端重新校验字段、HTTPS 来源、0–10 推荐值和精确文本重复，并只补仍为空的已有推荐值。缺少推荐值时按确定性评分规则自动补分。
- 单条语录编辑保留既有流程，并可编辑推荐值。新增界面文本由中英文 i18n 字典管理。
- 同步已在线的 `crm/css/console.css` 到发布版本，保留当时已部署的 iPad 知识列表布局。
- 修正 `person360.details` 隔离测试：等待异步家庭事实区出现后再断言；不改变 Person 360 页面或业务行为。

## 影响及数据状态

- 页面：每日激励语库管理页；接口：现有受设备授权保护的 `assistant` 函数及既有 `public.crm_daily_inspiration_v1` RPC。
- 使用现有线上 `recommendation_score` 列和 `scores_save` / `quote_save` RPC；本次没有数据库结构、权限、客户流程或登录行为变更。
- 本次仅部署函数 `assistant`，以及托管文件 `crm/css/console.css`、`crm/js/modules/console/i18n.js`、`crm/js/modules/console/pages/daily-inspiration.js`。未上传 `admin.html` 或项目目录。
- `中英文经典语录库.xlsx` 导入包包含 57 条新增语录、5 条待补分记录、3 条已去重候选；线上尚未导入任何语录或修改任何推荐值。导入需操作人通过已登录 CRM 页面预览并点击确认。

## 验证

- JavaScript 语法检查及每日激励语服务端/浏览器测试：9/9 通过。
- WP01：`PASS_WITH_LIMITATIONS`；目录权限检查 1,773 项通过；身份覆盖审计 1,368 条活动记录、0 个例外；匿名探针 123/123 通过；隔离回归 102 项通过、0 失败、5 项历史预设跳过；iPad/双语 PC34 检查通过。
- 线上同步：110 个可达页面/模块/样式与本地一致；30 个函数的 347 份源码/配置及 60 份共享副本与线上一致；GitHub `master`、发布标签和本地提交一致。
- 未验证项：真实用户登录后的导入确认和数据库写入、service-role 运行时写入、真机/移动端验收。线上业务数据写入未执行。

## 发布与回滚

- 功能代码发布：提交 `cd11f843e6d4513dea052766ba8d8d0fca46a622`；标签 `release-20261121-073802`。
- 发布前基线：标签 `release-20261120-225439` / 提交 `a914c9c203b0f0737203292713109225ff7f38be`。
- 回滚时恢复 `assistant/daily-inspiration-service.js`、`crm/js/modules/console/i18n.js` 和 `crm/js/modules/console/pages/daily-inspiration.js` 到前一标签并重新部署 `assistant` 与这两个 JS 文件；保留当前 `console.css`，因为它同步的是发布前已在线的 iPad 样式。无数据库迁移或用户数据回滚。

