# 「今日」页语录与报表入口对齐

- 基线和恢复版本为 `3ae773fa970bfd7ade97a16926b516ca28f6ed86`、`release-20261121-223037`。该版本的发布后检查已通过本地、GitHub 和线上源码比对。
- 「今日」页头保留固定的 TODAY，移除中英文说明行。主题与菜单作为一组跟在语录句尾，可以随语录换行。报表入口与语录首行对齐，窄屏显示「报表」或 Report，辅助技术可读取完整名称。
- 发布清单仅包含 `crm/css/console.css`、`crm/js/modules/console/i18n.js`、`crm/js/modules/console/pages/daily-inspiration.js` 和 `crm/js/modules/console/pages/today.js`。本轮业务变更限于页头显示及既有报表入口位置。语录获取、定时刷新、换一条和报表读取继续使用原接口与权限。
- `node --test --test-concurrency=1 tests/console/daily-inspiration.browser.cjs` 的 6 项浏览器用例通过。覆盖 iPad 与 iPhone 横竖屏、系统中文切英文再切中文、中英文长语录换行、菜单位置和视口边界、菜单选择和返回、报表路由与读取、按时段刷新、语录管理。
- 发布门槛使用 WP01 报告，最终一致性使用发布脚本的云端读回核对。浏览器验收使用合成数据与设备模拟。真实 iOS Safari、生产 CRM 账号和真实报表数据未作为测试输入。
- 如需恢复，从基线版本取上述 4 个静态文件部署，生成并推送恢复提交及标签，再复跑一致性和页头回归。
