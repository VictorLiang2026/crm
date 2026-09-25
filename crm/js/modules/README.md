# 新 AI 功能模块

每项新 AI-native 功能在此目录建立独立 ES module。只通过 `core/api.js` 注入的现有 `callFn` 调用 CRM 云函数；重要 AI 结果先供人审阅，再由明确的确认操作产生业务影响。模块只能注册 `#/ai/` 下的新路由，不修改旧路由。
