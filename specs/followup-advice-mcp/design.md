# 技术设计

## 架构

继续使用现有 `knowledge_mcp` HTTP Function、OAuth 2.1/PKCE、HMAC 内部桥接和 `assistant` 的固定 MCP allowlist。新增三个工具：

- `followup_gpt_task_package(personId?, afterId?, limit?)`：调用现有 `gptTaskPackage`，可按精确 Person ID 缩小范围，limit 最大 10。
- `followup_gpt_import_preview(rows)`：调用现有 `gptImportPreview`，由 CRM 重读当前行及可用来源、验证版本与空 GPT 栏位，并写入短期预览锁。
- `followup_gpt_import_confirm(adviceId, personId, systemVersion, previewId)`：调用现有 `gptImportConfirm`，不接受任意内容或客户端 `confirmed` 字段，只能执行预览中绑定当前 OAuth 用户的准确行。

任务包/预览数据与 HTTP 请求一样受限于 CRM MCP OAuth 身份；内部 assistant 仅接受 HMAC 签名的固定工具和精确字段。禁止把 CloudBase 管理凭据、原始 SQL 或通用函数调用暴露给 MCP。

## 权限

- 新增独立 `followup:read` 和 `followup:gpt:submit` scopes。任务包需要前者；预览和确认同时需要两者。
- OAuth 授权至少请求 `knowledge:read` 或 `followup:read` 之一；`followup:gpt:submit` 必须和 `followup:read` 配对。知识库的旧 scopes 不授予跟进建议权限。
- 更新 `public.crm_knowledge_mcp_grants` 的 scope 检查约束，新增配对 migration/rollback。现存 grants 原样保留，权限需用户在 CRM 同意页重新授权后才生效。
- 同意页以简体中文/英文分别显示跟进建议读取和写入说明，并明确建议会先预览且必须逐条确认。

## 保存顺序

Skill 读取任务包，生成 JSON，调用服务端预览；把服务端返回的 Person、系统版本、建议文本及来源展示给用户。每条需等用户明确确认后才调用对应的确认工具。服务端确认时再次核验 preview ID、actor、Person/advice 关联、版本、有效期、系统状态和空 GPT 栏位。成功后回读并报告结果。跳过或失败行不自动重试。

## 数据与兼容

- 仅修改 `public.crm_knowledge_mcp_grants` 的校验约束；建议写入复用既有 `public.person_followup_advice` 服务流程，无新增业务字段或表。
- 添加 `gptTaskPackage` 的可选 Person ID 筛选，不改变默认分页/批量行为。
- `assistant` 和 `knowledge_mcp` 只增加固定工具与 scope 检查，保持既有 Knowledge MCP 工具和 OAuth client 行为。
- 线上写入回归使用合成、专用测试记录；不使用真实客户建议做破坏性测试。

## 验证

针对工具 schema、OAuth scope 配对/拒绝、HMAC bridge 精确 allowlist、Person 筛选、预览版本及来源校验、操作者/预览绑定、确认写入与重复/过期拒绝编写回归。另检查 bilingual consent、旧 knowledge scopes 兼容、schema migration/rollback 和线上路由/元数据。按项目发布门禁部署后验证线上 MCP discovery 和无真实客户数据的授权/预览/写入路径。
