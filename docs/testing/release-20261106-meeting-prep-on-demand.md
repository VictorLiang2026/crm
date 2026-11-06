# 会前准备按需生成与超时修正 — 2026-11-06

## 基线与问题

- 本轮基线：本地和 GitHub `master` 为 `28e4082df2805ce04494e14f17c0923b7d964fb7`，回滚标签 `release-20261106-2155`。修改前针对性下载核对 `assistant/index.js`、`meeting-prep-service.js`、`person-ai-history-service.js` 和 `summarize-service.js` 与云端一致；96 个在线前端资源一致。全量 `sync-check` 在本轮代码修改后运行到 `assistant/index.js` 时发现预期差异，发布后重新完整核对。
- 线上 `public.ai_tasks` / `public.ai_runs` 只读检查：2026-11-06 21:53 的 `meeting_prep` 任务 #191 在约 30009 毫秒后以 `TIMEOUT` 失败，无结果；同一人物无较早的会前准备结果。原服务把模型超时固定为 30000 毫秒，页面点击即同步生成。

## 变更与兼容

- 人物详情的“会前准备”先读取该人物最近任务状态与已有生成结果；“生成／重新生成”按钮才启动模型。旧版“AI 历史”保留，结果字段保持不变；简体中文和英文文本均在 Console i18n 字典中。
- `assistant` 的会前准备模型等待上限为 100 秒，只尝试一次；新增异步任务启动和 `aiTaskStatus(meeting_prep)` 查询，前端最长轮询 150 秒。状态读取验证人物仍有效，严格限定人物编号与任务类型。失败显示实际任务状态，超时任务不冒充已生成结果。
- 原有同步 `meetingPrep` 请求仍可返回完整结果。数据库表、字段、RLS、路由、模型选择配置及其他 AI 功能未修改；无需数据库迁移或 SQL rollback。生成仍只写 AI 审计记录，不写人物业务数据。

## 验证

- 已完成：变更文件 JS 语法检查、`git diff --check`。
- `node --test tests/pc33/meeting-prep-async.test.cjs tests/pc33/person-ai-resilience.browser.cjs tests/pc33/ai-task-polling.test.cjs tests/pc33/ai-async-response.test.cjs tests/pc23/person-ai-history.test.cjs tests/ai-gateway/meeting-prep.cjs`：19 通过、0 失败。包括 iPad 中英文页面、只读打开、明确生成、旧结果、失败状态、人物作用域与异步响应。
- `npm test`：108 通过、0 失败、5 跳过；覆盖登录、客户、跟进、活动、增员、回收站与相邻旧功能。
- `npm run test:wp01`：`PASS_WITH_LIMITATIONS`，阻断项 0；人工登录、服务角色运行时、生产业务写入仍未验证。
- CloudBase 代码复核：沿用已有登录身份检查、`public` REST 读取和 AI Gateway 模型配置；未暴露密钥或请求头，未新增浏览器直连数据库。
- 部署后对 `assistant.aiTaskStatus(meeting_prep)` 使用不存在的编号进行未登录只读调用：函数正常响应 `UNAUTHORIZED`，调用编号 `33d02b3d-99ee-4d8f-808d-6d27d8c84e5a`；未触发 AI 或业务写入。生产登录态下的状态读取和实际 100 秒模型生成仍待人工体验验证。

## 部署和恢复

- 仅部署 `assistant` 云函数及三个 Console 文件：`crm/js/modules/console/data.js`、`i18n.js`、`pages/person.js`。
- 如需恢复，从 `release-20261106-2155` 重部署以上四项，按项目发布流程创建恢复提交与标签。AI 审计任务不自动删除；不存在业务数据 rollback。
- 发布后需核对云端源码、GitHub 提交和标签，并只读检查任务状态接口。未经明确授权，不对真实人物触发模型生成。
