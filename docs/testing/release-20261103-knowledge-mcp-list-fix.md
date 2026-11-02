# 2026-11-03 CRM Knowledge MCP 列表修复

## 范围与影响

- 修复 `knowledge_mcp` 将工具定义对象误传为工具名的问题；MCP 列表、记录读取及 GPT 摘要提交共用的工具名转发恢复正常。
- `assistant` 列表分发只接受允许的分页字段，忽略 MCP 内部传输元数据；失败响应保留安全错误码和结构诊断，不返回调用值或内部错误文本。
- 未变更数据库、schema、权限、页面或现有普通 assistant 流程。仅部署 `assistant` 与 `knowledge_mcp`。

## 验证

- Node 语法检查、定向 MCP 测试通过。
- WP01 发布门禁：PASS_WITH_LIMITATIONS；回归 108 通过、0 失败、5 跳过；匿名检查 81/81；无阻塞项。
- CloudBase 云端源码核对：30 个函数、243 个源码/配置文件与本地一致；仅核对云端，不代表 GitHub 一致。
- 线上 MCP 列表成功，分页覆盖显示来源、知识条目和 playbook 均无后续页。
- K-9 对应 `knowledge_items` ID 9（《Ascend2027开门红服务精讲》）：系统原文读取成功；GPT 摘要生成命令完成并返回 `pending_review`。命令状态可读到待审摘要，记录读取确认 `hasPendingReview=true`。未确认或发布。

## 回滚与未验证项

- 回滚代码基线：`release-20261102-182340`；如需回滚，需重新部署该标签下的 `assistant` 与 `knowledge_mcp`，并创建恢复提交，不回滚知识库数据。
- WP01 未验证项：人工登录、service-runtime 实际运行身份、非本工作包 live-writes、真实移动端视觉验收。
- 待审摘要由生成命令状态可见；知识记录只读接口仍将已确认的 GPT 摘要与待审队列分开呈现。
