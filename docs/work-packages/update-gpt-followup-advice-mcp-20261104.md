# 更新 GPT 跟进建议 MCP 写入

日期：2026-11-04  
状态：已部署；等待 OAuth 重新授权后完成认证工具发现和逐条写入验证。

## 范围与影响

- 为现有 Knowledge MCP 增加独立 `followup:read` 与 `followup:gpt:submit` scopes，以及任务包读取、服务端预览、逐条确认三个工具。
- `assistant` bridge 只接受固定工具名和精确字段；确认工具不接收客户端 `confirmed`，服务端仅在有效预览确认时设置确认状态。
- 人物任务包按精确 Person ID 可选筛选，最多每页 10 条；只选择系统建议 ready 且 GPT 策略和产品/服务段都为空的记录，返回脱敏的人物、互动、系统建议和相关知识上下文。
- 更新 CRM OAuth 同意页的中英文权限说明；更新本机 `update-gpt-followup-advice` Skill，使其先展示服务端预览、等用户逐条明确确认后才调用确认工具。
- 不自动扩展现有 OAuth grant。已有用户需重新登录 CRM 同意页并授予新权限。

## 数据库

- 迁移 `20261104170000_followup_advice_mcp_scopes` 已应用，仅修改 `public.crm_knowledge_mcp_grants` 的 scope 校验约束；提交了成对 rollback。
- 已通过迁移历史确认版本已登记，并只读查询确认新 scope 约束及 submit 必须配套 read。
- Rollback 在任何 grant 仍持有新 scope 时主动失败，避免移除已授予权限。

## 发布范围

- CloudBase 函数：仅 `assistant`、`knowledge_mcp`。
- 静态托管：仅 `/crm/oauth-consent.html`、`/crm/js/modules/console/i18n.js`、`/crm/js/modules/console/knowledge-mcp-consent.js`。
- 未新增或修改路由、函数配置、AI 厂商配置或环境变量；现有 MCP OAuth 路由保持启用。

## 验证

- 定向 MCP/OAuth/bridge/跟进服务/迁移/中英文同意页测试：39/39 通过。
- WP01：PASS_WITH_LIMITATIONS；目录检查 1,248 项通过；WP02–WP06、PC34、安全 guard 和完整隔离回归均通过；回归 108 通过、0 失败、5 跳过；匿名探针 81/81。
- JS 语法检查、`git diff --check`、共享模块 60 份副本核对通过。
- CloudBase CloudOnly：30 个函数、243 个源码/配置文件匹配；96 个页面/模块/样式资源匹配。
- OAuth metadata 的 issuer、资源 metadata 返回新 scopes；静态同意页及两个 JS 资源 HTTP 200；静态托管目录确认三份文件存在。
- 未认证的 MCP `tools/list` 按预期返回 401 `MCP_AUTH_REQUIRED`。未使用真实人物做写入验证。

## 人工授权与未验证项

- 在 ChatGPT/Codex 中重新连接 Knowledge MCP，经 CRM OAuth 同意页授权跟进建议读取和 GPT 提交 scope。既有授权不会静默升级。
- 使用 Skill 时先检查/生成预览并展示给用户；只有用户对具体人物建议逐条明确确认后，服务端才会写入空的 GPT 栏位。
- 认证后的工具发现、真实人物建议写入以及清空后再次补充尚未端到端验证；登录、service-runtime 和手机端也保留 WP01 所列未验证状态。

## 回滚

- 代码回滚：在 `assistant`、`knowledge_mcp` 上重新部署本次变更前的 master 版本，并以新恢复提交发布；保留 consent 页不授予权限不会产生写入能力。
- 数据库回滚：先确保没有 grant 持有任一 follow-up scope，再执行配对 rollback；脚本内包含强制前置检查。
