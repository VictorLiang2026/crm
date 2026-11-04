# GPT 跟进建议直写发布记录

- 日期：2026-11-05
- 范围：CRM Knowledge MCP 与 Assistant 的跟进建议直写；Codex OAuth scope 授权页。
- 数据环境：`crm-d1gkae8ddc930d151`，仅 `public` schema。

## 变更

- 新增独立 OAuth scope `followup:gpt:direct_write`，并要求同时授权 `followup:read`；保留既有读取、预览和确认流程。
- 新增 `followup_gpt_advice_save` 工具。服务端逐条核对 Person/建议 ID、ready 状态、系统版本、GPT 字段为空及来源有效性，只写入 GPT 字段。同一 Person 多条建议按精确建议 ID 分别保存。
- 更新双语 OAuth 授权页与 `update-gpt-followup-advice` Skill。写入后可在 CRM 编辑；字段清空后可再次补充。
- Migration `20261104180000` 已成功应用。回滚前需先撤销所有 `followup:gpt:direct_write` 授权。

## 发布范围

- Cloud Functions：`assistant`、`knowledge_mcp`。
- 静态托管：`/crm/oauth-consent.html`、`/crm/js/modules/console/knowledge-mcp-consent.js`、`/crm/js/modules/console/i18n.js`。
- 数据库：仅变更 `public.crm_knowledge_mcp_grants` 的 scopes check constraint。

## 验证

- `node --test tests/knowledge-mcp/*.test.cjs tests/knowledge-library/followup-advice-service.test.cjs`：51 通过，0 失败。
- `npm run test:wp01`：发布门禁 PASS_WITH_LIMITATIONS；匿名网关 81/81，通过 108 项隔离 regression、WP04 明示身份例外验证。
- `tools/sync-check.ps1 -CloudOnly`：96 个页面资源及 30 个函数的 243 个源码/配置文件与线上一致。
- 迁移计划可执行；应用任务成功，远端迁移历史最新版本为 `20261104180000`。

## 未验证项与恢复

- 本会话尚未获得新 OAuth scope 的交互式用户授权，当前工具清单也未刷新；需在 Codex CRM Knowledge 应用重新连接并同意 `followup:read` 与 `followup:gpt:direct_write`，新会话中才能调用直写工具。
- 未对真实 Person 记录执行建议生成或写入。真实登录、service runtime 写入、移动设备验收仍按 WP01 报告标为未验证。
- 函数与静态文件可按历史发布标签恢复；数据库 rollback 文件会在存在直写 scope grant 时拒绝执行。撤销相关 grant 后才能回滚迁移。
