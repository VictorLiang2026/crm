# AI-native 前端模块承载层

本阶段只建立浏览器原生 ES modules，不引入打包器、不改 `admin.html`，也不注册新页面。现有登录、`#/customers` 等旧路由、`callFn` 和页面样式保持原样。未来新 AI-native 功能必须落在 `crm/js/modules/`，组件放在 `crm/js/components/`，样式放在 `crm/css/` 并使用 `.crm-ai` 命名空间。仓库路径 `crm/js/...` 对应静态托管路径 `/crm/js/...`。

`core/api.js` 只接受由已登录旧页面提供的 `callFn`，不新建 CloudBase SDK、直连数据库或模型客户端。`core/feature-flags.js` 默认关闭全部新功能。`core/router-extension.js` 只允许注册 `#/ai/` 命名空间的路由，默认不监听 hash 事件、不接管旧路由；`core/state.js` 提供每个新功能实例自己的状态。`core/index.js` 是未来模块的导入入口。

新增第一个功能时，须单独评审最小宿主接线：在既有登录完成后传入 `callFn`；只在启用对应 feature flag 后，把新的 `#/ai/` 路由交给扩展路由，并在旧路由兜底前处理；保留旧路由和会话检查。该接线属于后续功能工作包，本轮没有实施。重要 AI 结果必须由人确认；模型选择由 AI Gateway / CloudBase 配置提供，模块不得写死厂商。

静态文件仅包含框架代码与局部样式，不含凭据或数据。运行 `npm run test:modular` 验证 API 桥接、禁用态、路由隔离及状态；现有 `npm test` 验证旧页面回归。撤回本阶段可移除新增承载文件与约定，线上旧页面无需回滚。
