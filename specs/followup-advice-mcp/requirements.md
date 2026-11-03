# CRM 跟进建议 MCP 写入

## 问题与范围

`update-gpt-followup-advice` 能依据 CRM 提供的人物、系统建议和知识上下文生成 GPT 建议，但 CRM Knowledge MCP 尚未暴露任务包、服务端预览和确认写入工具。本变更通过现有 OAuth/MCP 通道接通该流程。

包含：为跟进建议增加专用 OAuth 读取和 GPT 提交权限；暴露有界任务包、服务端导入预览和逐条确认工具；更新本机 Skill 以调用这些工具。

不包含：修改 Person、CloudBase 系统建议、建议生成算法、跟进建议 UI 或其他知识库权限；不覆盖已有 GPT 建议；不读取 `pr` schema 或 `pr_*` 函数。

## 用户故事

作为已登录并单独授权跟进建议权限的 CRM 用户，我希望 Skill 根据 CRM 验证的人物和知识上下文生成 GPT 建议，先查看服务器核实的预览，再逐条确认写入，以便补全空的 GPT 栏位而不覆盖系统或已有建议。

## 验收标准

1. 当 OAuth 客户端请求跟进建议读取权限时，MCP 只在有效 CRM OAuth grant 包含 `followup:read` 时返回跟进任务包；任务包可限定精确 Person ID，并保持不超过 10 条的有界分页。
2. 当 OAuth 客户端请求 GPT 提交权限时，CRM 服务端只在 grant 同时包含 `followup:read` 与 `followup:gpt:submit` 时允许预览和确认操作。
3. 当提交候选建议时，服务端核实准确建议 ID、Person ID、系统版本、系统 ready 状态、GPT 栏位仍为空及知识来源白名单；预览产生不可猜测、绑定操作者且有时效的 ID。
4. 当用户查看预览并明确逐条确认后，服务端仅写入对应 GPT 标题、策略、产品/服务内容和核实过的来源字段；系统建议及 Person 数据保持不变。
5. 当版本过期、来源无效、GPT 栏位已填、操作者不匹配或预览过期时，操作失败关闭，不写入业务建议。
6. 当已有 OAuth grant 未含新增 scope 时，MCP 不自动扩大权限；用户必须重新完成 CRM OAuth 同意。
7. 当现有 Knowledge MCP 用户仅持有 `knowledge:read` / `knowledge:gpt:submit` 时，现有知识库工具继续按原权限工作，且不能由这些 scope 获得跟进建议写权限。
8. 新数据库约束迁移只作用于 `public`，同时提交 rollback；不调用或修改 `pr` schema / `pr_*` 函数。
