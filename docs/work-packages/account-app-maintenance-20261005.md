# 账号与应用维护：发布记录

日期：2026-10-05。修改前基线为 `4c9f586d151a6d0ae9df667127ef977cbf162d33` / `release-20261005-105248`；本地、GitHub、云端主页面与 25 个引用资源一致，28 个 CRM 函数、166 个源码/配置文件一致。

## 范围与兼容

- `更多 → 账号与应用维护` 新增修改密码、退出登录和强制加载最新版；现有用户名密码登录继续使用 CloudBase 认证，五分钟无操作重新登录机制保留。
- 登录与重新登录检查 SDK 返回的 `error`；退出后隐藏主导航和快速记录按钮，路由在未登录时不渲染业务页。改密只使用当前账号的 `resetPasswordForOld`，成功后退出并回到登录页。
- 强制刷新在确认未保存输入会丢失后，给当前页面 URL 写入新的 `_fresh` 参数并完整重载。线上主页面、模块和样式的 HTTP 响应已核实为 `no-store`。此功能不调用浏览器全局清缓存，不清除登录凭据、`todayCoachCache` 或 CRM 业务数据。
- 只改 `admin.html`、`crm/js/modules/phase14-hubs.js`，新增 `crm/js/modules/account-settings.js`；测试夹具同步调整。CloudBase 函数、`public` 数据结构、权限、`pr` 相关对象、旧 Routes 和旧业务流均未修改。

## 验证

- 新增隔离浏览器用例：SDK 返回认证错误、五分钟超时、更多入口、强制重载与本地缓存保留、退出失败与成功、退出后旧路由隔离、旧密码错误、改密成功后重新登录。
- `npm run test:modular` 通过；完整离线回归 107 PASS / 0 FAIL / 5 SKIP。`npm run test:wp01` 为 `PASS_WITH_LIMITATIONS`，权限目录 784 项、匿名网关 59/59 通过；WP04 身份审计为 `PASS_WITH_EXCEPTIONS`，沿用 6 条既定例外。
- 未使用真实账号执行线上改密或退出操作；真实登录、认证 SDK 的生产端到端行为及 iPad 真机视觉验收仍需人工确认。自动化只使用隔离夹具，不写生产业务数据。

## 发布与回滚

- 仅上传 `/crm/admin.html`、`/crm/js/modules/phase14-hubs.js`、`/crm/js/modules/account-settings.js`。发布后核对三个文件及完整本地/GitHub/云端一致性。
- 若需恢复，基于 `release-20261005-105248` 重新部署原 `admin.html` 与 `phase14-hubs.js`，创建恢复提交与新标签；新增模块文件可保留为无入口文件，不删除已有托管资源。无数据库回滚。
