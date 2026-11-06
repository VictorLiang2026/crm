# CRM Assistant | CRM 助手

## Capabilities / 能力范围

This private plugin connects to the existing `CRM Knowledge MCP` endpoint and packages two CRM workflows:

- Update missing GPT follow-up advice using server-verified preview and per-record human confirmation.
- Generate missing GPT knowledge summaries from the stored system original, with the existing server-side version check.

本私有插件连接现有 `CRM Knowledge MCP` 服务，打包两个工作流：

- 使用服务端核验的预览，并逐条由人确认后补充 GPT 跟进建议。
- 根据已保存的系统原文生成缺失的 GPT 知识摘要，并使用现有服务端版本校验。

The server currently exposes knowledge and follow-up tools only. This package does not add general customer, activity, recruitment, or unrestricted CRUD access. The separate `followup:gpt:direct_write` scope is not requested by default and is not used by the follow-up skill.

当前服务端只开放知识与跟进相关工具；本包不增加客户、活动、增员等通用读取/写入，也不开放任意 CRUD。独立的 `followup:gpt:direct_write` scope 不作为默认授权，跟进建议 Skill 不调用直写工具。

## Quick authorization / 快速授权

Install the plugin, then complete the CRM OAuth consent once. The default request includes `knowledge:read`, `followup:read`, `knowledge:gpt:submit`, and `followup:gpt:submit`, enabling both packaged skills. CRM still verifies each operation. Follow-up advice requires a fresh, explicit human confirmation for each previewed record.

安装插件后，通过 CRM OAuth 页面完成一次授权。默认申请 `knowledge:read`、`followup:read`、`knowledge:gpt:submit` 和 `followup:gpt:submit`，用于启用两个已打包的 Skill。CRM 仍会逐次核验操作；跟进建议必须由人对预览中的每条记录明确确认。

## Compatibility / 兼容性

The existing MCP endpoint, function names, tool names, scopes, database schema, and CRM routes are unchanged. The old `CRM Knowledge` connection remains usable. The plugin is an additive, privately saved ChatGPT/Codex package; OAuth consent is per plugin connection and does not transfer existing grants. Users may keep both connections during rollout.

现有 MCP 地址、云函数名、工具名、scope、数据库结构和 CRM 路由均不变，旧 `CRM Knowledge` 连接继续可用。本插件作为私有 ChatGPT/Codex 插件新增；OAuth 授权按连接分别记录，不会继承旧连接的授权。切换期间可以保留两个连接。
