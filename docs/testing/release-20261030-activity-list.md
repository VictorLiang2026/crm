# 活动列表优化发布记录

## 范围

- 移除活动工作台下方的 7 天日期条，改为起止日期筛选。
- 活动列表显示名称、日期、类型、地点、状态；五列均支持排序。
- 保留现有活动详情、顶部操作入口及“今日”旧列表接口。
- 不涉及数据库迁移、权限变更或新云函数。

## 影响与兼容

- 页面：`#/activities`。
- 前端文件：`crm/js/modules/console/pages/activities.js`、`crm/js/modules/console/i18n.js`、`crm/css/console.css`。
- 后端：现有 `activities` 云函数 `directory` 查询支持起止日期和地点/状态排序；`activities:list` 行为保持不变。
- 新增 UI 文案已提供简体中文和英文。

## 验证

- `tests/activity-directory/directories.test.cjs`：通过，覆盖日期边界、排序、分页与旧列表兼容。
- `tests/activity-directory/directories.browser.cjs`：通过，覆盖 iPad 横竖屏宽度、筛选清除、排序及英文文案。
- `tests/pc16/activity-management.*`：通过。
- `npm test`：108 通过、0 失败、5 项标记为未执行的真实线上/登录检查。
- `npm run test:wp01`：PASS_WITH_LIMITATIONS；公开目录 1166 项检查通过，匿名探针 77/77，WP04 身份审计与隔离回归通过。真实登录、生产写入和实体移动设备未验证。
- `git diff --check`、云函数语法检查、模块桥接检查：通过。

## 数据与回滚

- 本次无数据操作、数据库迁移或 schema 变更。
- 回滚方式：从本次前一发布标签恢复以上 4 个业务文件，重新部署 `activities` 函数和 3 个静态模块文件；无需数据库回滚。

## 发布记录

- 基线提交：`887f61d48ca6a25c830297a4e7d791ce21a4214f`（2026-10-30 最新 `master`）。
- CloudBase：`activities` 函数部署成功；仅上传上述 3 个静态文件。
- 云端核验：主页面 SHA-256 相符；91 个页面资源相符；29 个 CRM 函数的 228 个源码/配置文件相符。
- 线上只读验证：调用 `activities:directory`，日期范围 `2999-12-31` 至 `2999-12-31`，返回 `rows=[]`、`hasMore=false`；未读取或输出业务记录。
- 业务代码提交：`3145a81e6493907a32277943faa0dd577db8affe`。
- 业务代码发布标签：`release-20261030-0645`。
- 本次文档补录不改变云端业务产物；云端产物仍对应上述业务代码提交与标签。
