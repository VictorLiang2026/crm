# 活动目录列表改造发布记录

基线：GitHub `master`、本地与云端源码一致，提交 `60d3e2ddf43afe4f0b86069636ff0c4482505f22`，回滚参考标签 `release-20261029-123232`。独立工作树开发，未带入原工作区的未提交改动。

## 变更与影响

- Console 活动工作台将“嘉宾与主题”入口拆为“嘉宾资料”和“活动主题”两个直达入口。三个目录使用可搜索、可点击双向排序的表格和服务端分页，每页 30 条，服务端最多 50 条。
- 新增 Console 路由 `#/activity-speakers`、`#/activity-topics`；保留旧 `#/activity-resources` 路由、活动详情资源页及 `admin.html` Legacy 页面。
- 扩展既有 `activities`、`activity_speakers`、`activity_topics` 云函数的只读 `directory` 查询；旧 `list` 行为保留。嘉宾按 Person 展示名排序；搜索扫描超出既有界限时明确报错，不展示不完整结果。
- 不新增或修改数据库表、字段、视图、RLS 与写入权限；不触及 `pr` schema 或 `pr_*` 函数。无需 migration／rollback。
- 托管更新范围仅为 `crm/css/console.css`、`crm/js/modules/console/{activity-people,data,i18n,router,views}.js`、`crm/js/modules/console/pages/activities.js`。云函数仅部署上述三个既有函数。

## 验证

- 变更前 `tools/sync-check.ps1`：GitHub、云端页面资源、29 个 CRM 函数源码一致。
- Node 语法检查、`git diff --check`、`tests/tooling/modular-frontend.mjs` 通过。
- 活动目录服务端测试：超过旧 100 条上限的搜索、跨页排序、日期过滤；嘉宾 Person 展示名排序；主题跨页排序；非法排序参数拒绝。
- 活动／嘉宾／主题三个直达目录浏览器测试：导航、搜索、排序、分页、iPad 横竖屏、英文标题均通过。
- 旧嘉宾／主题目录和活动管理测试通过；`npm test` 完整隔离回归 108 PASS、0 FAIL、5 SKIP。
- `tests/pc34/run.cjs`：公开角色权限矩阵、真实 service_role 只读核查、业务链隔离测试、中英双语 iPad 检查通过；三个新页面纳入双语回归。
- WP01 门槛须在最终文件固定后重新运行，通过后方可部署；部署后执行云端一致性核对与目标函数实际只读调用。

## 恢复与未验证项

- 前端／云函数如需恢复，基于 `release-20261029-123232` 创建恢复提交并仅重新部署本轮涉及产物，禁止强推或静默回滚数据。本轮没有数据库变更。
- 不使用真实客户数据做新增、删除、恢复等破坏性测试。真实账号交互登录、生产写入链路、手机布局不在本轮验收；发布后单列实际只读调用与页面访问结果。
