# iPad Pro 12.9 英寸横屏体验优化 — 2026-11-20

## 范围与变更

- Console 与保留的 Legacy 入口增加仅在宽屏横屏触控设备启用的布局规则，目标为 iPad Pro 12.9 英寸第 5 代约 1366×1024 CSS 像素。
- Console 顶栏和工作区使用更合适的横向密度；今日工作台保持主次分栏；人物 360 将分区导航固定在左栏；人物、招募、活动、回收站目录在横向滚动时保留首列；长弹层扩大可视空间并保持标题可见；机会详情在 iPad 横屏改用右侧检查面板。
- Legacy `admin.html` 只增加限定横屏样式，保留旧页面结构、路由和处理器。
- 变更资源：`crm/css/console.css`、`crm/css/phase14-navigation.css`、`crm/js/modules/console/pages/person.js`、`crm/js/modules/console/write.js`、`crm/js/modules/console/pages/opportunities.js`。
- 未改数据库、Cloud Functions、权限、API、路由、登录或业务数据；写入预览与人工确认链保持原样。

## 验证

- 1366×1024 隔离 Chromium 触控视口视觉检查：今日工作台与人物目录均正常显示，无横向溢出；主导航、快捷记录、分栏和列表空间符合横屏布局。
- Console 人物目录、Person 360、招募目录、机会人物搜索、三端既有导航行为、活动/讲者/主题目录、PC16 活动工作流、PC34 iPad 双语/触控/键盘，以及 Legacy 机会维护浏览器回归：21 项通过。
- `tests/pc22/knowledge-governance.browser.cjs` 中 1 项既有列宽断言失败；在未修改的 `master` 基线独立复现，判定为本轮前已有，不扩展工作范围修复。该文件其余 2 项通过。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`，阻断项 0。public 目录 1719 项、匿名探针 119/119、WP04 public 只读身份核验、PC34 关键矩阵通过；隔离 regression 102 PASS、0 FAIL、5 个预设跳过。真实登录标记 `MANUAL_LOGIN`，service-runtime 和 live-writes 维持 `UNVERIFIED`。
- CloudBase 静态托管 5/5 文件上传成功；`tools/sync-check.ps1 -CloudOnly`：109 个可达静态资源及 30 个 CRM 函数的 346 个源码/配置文件均与本地一致。

## 发布标识

- 基线：`f0f989934d6ce6e26aa6dcce207d248d8e34a2bf`（`release-20261120-080752`）。
- Commit 与发布标签：见本文件对应的 Git 发布标签。
- 地址：[CRM Console](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/console.html)、[Legacy admin](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。
