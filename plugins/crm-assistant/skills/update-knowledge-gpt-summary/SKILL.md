---
name: update-knowledge-gpt-summary
description: "Use when asked to find CRM knowledge records missing a GPT summary, generate from the stored system original, and save through the authorized CRM Assistant MCP. / 当用户要求查找缺少 GPT 摘要的 CRM 知识记录，并基于已存系统原文生成后保存时使用。"
---

# 更新知识库GPT摘要 / Update Knowledge Base GPT Summaries

查找缺少 GPT 摘要的 CRM 知识记录，根据已保存的系统原文生成摘要，并直接写回同一条记录。英文名：**Update Knowledge Base GPT Summaries**。OCR 和附件文字识别由 CRM 后台负责；本 Skill 只读取系统文本字段。

## 访问与权限

- 只使用当前会话实际可调用、且已完成用户 OAuth 授权的 CRM Assistant MCP 工具。开始时先确认能实际读取知识库。
- 不把 CRM 密码、OAuth token 或其他凭据写入 Skill、提示词、日志或输出。
- 不用通用 SQL、CloudBase 管理工具、猜测的 HTTP API 或浏览器自动化绕过 CRM Assistant MCP。
- 若本会话没有 CRM Assistant MCP 工具，初始化失败、返回 401/403，或身份授权不可验证，停止并说明连接问题；不得回退到直接数据库读写。
- 不处理 `pr` schema、`pr_*` 对象或 `pr_*` 云函数。

## 内容边界

- 摘要只能来自该记录已保存的系统原文文本字段。不能从标题、系统摘要或附件猜补原文。
- 不读取或下载附件/图片；OCR、图片识别和附件解析由 CRM 后台负责。
- 只更新 GPT 摘要字段。不得更改系统原文、系统摘要、附件、来源关联或记录元数据。
- 摘要忠实保留原文中的关键事实、数字、日期、条件和限制，不加入原文没有的信息。
- 保存必须使用精确记录类型、记录 ID 和服务端要求的版本校验值；不能只凭标题匹配。
- 保存成功后内容立即写入并可使用；不走预览、待审核、确认或发布流程。不要调用旧的审核或进度操作。

## 处理流程

1. 若用户指定记录，按指定类型和稳定 ID 处理；否则完整分页扫描各知识记录类型，直到所有类型都明确 `hasMore=false`。分页信息缺失或扫描中断时，报告部分扫描，不声称全库完成。
2. 对每条记录按稳定 ID 读取详情，确认系统原文、GPT 摘要和版本信息。
3. GPT 摘要已有内容时跳过，不覆盖。GPT 摘要缺失而系统原文为空、未就绪或识别失败时，停止该条并报告。
4. 对原文可用且 GPT 摘要缺失的记录，调用 CRM Assistant MCP 的 GPT 摘要生成操作。该操作只基于已存系统原文生成摘要，并直接保存到同一记录。
5. 保存后按同一记录 ID 回读，核对 GPT 摘要已写入且系统字段未被改动。版本冲突、文件或原文缺失、生成失败、写入失败或回读不一致时停止该条，不盲目重试。
6. 汇总成功保存、因摘要已有而跳过、因原文未就绪而停止、其他失败数量，并说明扫描完整性。只报告必要的记录 ID 和失败原因，不复制整段原文。

## 不允许的操作

- 不读写附件字节，不在 Skill 中执行 OCR。
- 不用标题或文件名把摘要写入记录。
- 不调用审核、发布、系统字段编辑、清空或删除操作。
