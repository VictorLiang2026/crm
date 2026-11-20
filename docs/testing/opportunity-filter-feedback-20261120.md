# 机会页筛选反馈修复 — 2026-11-20

## 范围与影响

- iPad 横屏机会页的“查找人物”输入框恢复可用宽度；空结果容器隐藏，候选、校验和查询状态显示在锚定式浮层中。
- 空人物姓名与空搜索关键词会聚焦对应输入框并显示中英双语提示；人物查询按钮和关键词搜索按钮在请求期间显示加载状态，关键词完成后显示结果总数。
- 人物候选选择、清除、类别/来源选择、状态筛选的接口和数据语义保持现有行为；未改云函数、数据库、登录、路由或写入流程。
- 修改文件：`crm/css/console.css`、`crm/js/modules/console/pages/opportunities.js`、`crm/js/modules/console/i18n.js`、`tests/console/ipad-toolbar-layout.browser.cjs`。

## 验证

- 1366×1024 触控浏览器：人物姓名输入框宽度至少 160 CSS px；空态隐藏结果面板，校验提示/候选面板显示在筛选工具栏下方；验证空查询不调用接口、输入后候选可选择、选中人物 ID 进入列表查询、清除恢复未筛选状态；关键词空态聚焦并提示，非空搜索显示完成反馈；英文空态提示正确。
- 执行结果：机会页/iPad 工具栏、人物查询、旧版机会维护及 iPhone 相邻回归合计 7/7 通过。
- `node --check`（机会页、i18n、浏览器用例）及 `git diff --check` 通过。
- WP01 门禁：`PASS_WITH_LIMITATIONS`；权限目录 1,719 项通过、匿名只读检查 119/119 通过、WP04 人物映射审计 0 项异常；完整回归 102 PASS、0 FAIL、5 个历史跳过。

## 发布与恢复

- 静态托管上传成功 3/3：仅更新 `crm/css/console.css`、`crm/js/modules/console/pages/opportunities.js`、`crm/js/modules/console/i18n.js`；不部署云函数/数据库。
- 部署后云端核验：109 个可达页面/模块/样式资源一致；30 个云函数共 346 个源码/配置文件一致。
- GitHub 提交与发布标签由本轮 `tools/release.ps1` 流程完成。
- 生产入口：https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html。
- 恢复方式：从本轮提交回退这三个页面资源并重新部署，再创建恢复提交；不涉及数据回滚。
