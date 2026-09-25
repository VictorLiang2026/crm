# AI-native 前端模块承载层工作包

基线提交与回滚标签：`a6a892ffe73808e376fd92749c46f513f9aaabe6` / `release-20260925-081503`。改动前本地、GitHub、线上 `admin.html` 及 26 个 CRM 云函数的 108 个源码/配置文件全部一致。

本轮只新增 `crm/js/core/`、`crm/js/modules/`、`crm/js/components/`、`crm/css/`，并写明未来新 AI-native 功能的使用约定。`admin.html`、云函数、数据库、权限和现有路由均未修改。新增模块默认不装载、不注册路由、不产生网络调用；未来接线另开工作包。接口仍以现有 `callFn` 为入口。

验证：`npm run test:modular` 覆盖 API 桥接、禁用态、路由隔离与状态更新，已通过；`npm test` 覆盖旧页面回归，结果 57 PASS / 0 FAIL / 5 SKIP。静态托管仅发布本轮新增的 8 个 JS/CSS 文件，逐文件 HTTP 200、正确 MIME 与线上 SHA-256 一致；独立无账号浏览器从现有线上页面成功动态导入 `/crm/js/core/index.js`。旧页面与云函数继续由 `tools/sync-check.ps1` 核对。未进行真实登录、数据库写入或 AI 计费调用。

风险边界：本轮新增模块尚未由 `admin.html` 加载，因此没有新功能入口；这是刻意保持旧页面行为不变。未来接入第一个新功能时，必须补做登录后桥接、路由优先级、feature flag 和端到端回归。撤回本轮可恢复仓库新增文件；未被引用的线上静态资源不会改变旧页面行为。
