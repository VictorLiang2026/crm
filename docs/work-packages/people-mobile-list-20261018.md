# 人物列表手机端紧凑表格（2026-10-18）

## 范围与影响

- 仅修改 `crm/js/modules/console/pages/people.js` 与 `crm/css/console.css` 的手机端人物列表显示。
- 手机宽度下改为紧凑表格，显示姓名、客户/招募/转介优先级、本次/下次跟进日期和编号；隐藏转客户、转招募及客户经营阶段列。
- 手机日期显示为 `DD/MM`；表头保留排序，沿用每页 20 行及现有分页。
- 复用双语字典已有表头文本，不增加 API、数据库、权限、路由或云函数变更。iPad 布局和其他页面保持原行为。

## 验证

- `npm run test:people-pages`：4/4 通过，覆盖列表排序、筛选、多选搜索、招募标签与回收站相邻流程。
- `npm run test:modular`：通过。
- `node --check crm/js/modules/console/pages/people.js`、`git diff --check`：通过。
- `npm run test:wp01`：发布安全门禁 `PASS_WITH_LIMITATIONS`；核心检查通过，隔离回归 108/108、匿名探针 70/70，无失败。真实登录、生产写入、service runtime 和通用移动端人工验收按门禁报告保留为未验证；本次手机目录由专项浏览器测试覆盖。
- 手机端 390px 与 iPad 768px/1024px 视口回归通过；确认手机列、紧凑日期、排序分页及英文短表头，iPad 样式无变化。

## 发布与回退

- 仅上传 `crm/js/modules/console/pages/people.js`、`crm/css/console.css` 到生产静态托管对应路径。
- 无数据库 migration，无云函数部署。
- 回退基于前一版本标签 `release-20261018-152238`，恢复这两个文件并重新上传；不涉及数据回滚。
