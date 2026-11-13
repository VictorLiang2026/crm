---
name: update-knowledge-gpt-summary
description: "Use when asked to find CRM knowledge records missing a GPT summary and multi-volume documents missing a GPT total summary, then generate and save the missing summary through the authorized CRM Assistant MCP. / 当用户要求补充普通知识的 GPT 摘要或分卷知识的 GPT 总摘要，并通过已授权 CRM Assistant MCP 保存时使用。"
---

# 更新知识库GPT摘要 / Update Knowledge Base GPT Summaries

补齐普通知识记录的 GPT 摘要，以及分卷知识的 GPT 总摘要。系统后台负责附件解析和原文汇总；本 Skill 只调用 CRM Assistant MCP 的文本生成与保存能力，不读取附件或图片。

## 访问与权限

- 只使用当前会话中已授权且可实际调用的 CRM Assistant MCP 工具。开始前先确认知识库可读取。
- 不把密码、OAuth token 或其他凭据写入 Skill、提示词、日志或输出。
- 不使用 SQL、CloudBase 管理工具、猜测的 HTTP API 或浏览器自动化绕过 CRM Assistant MCP。
- 如果 MCP 不可用、授权不可验证或工具调用失败，按失败范围停止并报告；绝不回退到直接数据库读写。
- 不处理 `pr` schema、`pr_*` 对象或 `pr_*` 云函数。

## 处理流程

1. **先完整扫描分卷关系。** 调用 `knowledge_documents_list`，分别按 `offset` 和 `volumeOffset` 分页：文档页的 `coverage.hasMore` 与分卷来源页的 `volumeSourceCoverage.hasMore` 都变成 `false` 才算完成。收集每个文档的精确 `documentId`，以及每个 `volumeSources[].sourceId` 到 `documentId` 的映射；同时收集文档返回的 `volumeKnowledgeItemIds`。若工具不可用、任一分页未完成或分页覆盖信息缺失，停止整个任务，不能继续普通记录写入。
2. **处理每套分卷知识。** `gptTotalSummaryPresent=true` 时跳过。只有 `originalReady=true`、`systemSummariesReady=true` 且各 `partStatuses` 都有系统摘要时，才调用 `knowledge_generate_gpt_total_summary(documentId, expectedGptVersion)`。该服务端操作基于完整的系统原文生成并保存 GPT 总摘要；不向分卷子记录写摘要。
3. 分卷来源的 `documentId` 必须精确对应到一个 `partCount>1` 的汇总文档。无法对应的来源、重复或冲突关联、原文、任一卷的系统摘要或版本状态不完整/不明确时，停止该套并报告，不按标题、文件名或卷号猜测，也不降级到逐卷生成。已扫描到但未能对应汇总文档的来源一律视为关系不明，不能按普通记录生成摘要。
4. 汇总文档保存成功后，用 `knowledge_document_get(documentId)` 回读，确认 GPT 总摘要存在且版本已更新。若服务端返回“已存在”则记为跳过；写入冲突或回读不一致时报告失败，不盲目重试。
5. **再扫描普通知识记录。** 调用 `knowledge_records_list` 并按各类型的 `nextOffsets` 完整分页。对 `knowledge_items`，把所有 `volumeSources[].sourceId` 作为排除清单；命中清单的记录跳过，即使其文档关系不明也不得单条生成。`knowledge_items` 缺少 `sourceId` 时报告并跳过；`playbooks` 按普通记录处理。其余已有 GPT 摘要的记录跳过；其他缺少 GPT 摘要且系统原文可用的记录，按精确 `table`、`id`、`expectedUpdatedAt` 调用 `knowledge_generate_gpt_pending`，保存后用 `knowledge_record_get` 按同一 ID 回读确认。
6. 普通记录系统原文缺失、版本冲突、生成失败、保存失败或回读不一致时，只停止该记录并报告；不从标题、摘要或附件猜补内容。
7. 分别汇总普通摘要与 GPT 总摘要的成功、跳过和失败数量，并报告扫描是否完整。只输出必要的 ID 和失败原因，不复制整段原文。

## 内容边界

- GPT 总摘要来自该套分卷已汇总的系统原文；普通 GPT 摘要来自该条记录的系统原文。
- 不读取或下载附件/图片，不在 Skill 中执行 OCR。
- 不修改系统原文、系统摘要、来源、关联关系或其他元数据；不清空、不审核、不发布。
- 摘要忠实保留关键事实、数字、日期、条件和限制，不加入原文没有的信息。
- 分卷记录只作为汇总来源和排除对象；除非 CRM 明确识别为非分卷的普通记录，否则不得单独生成 GPT 摘要。
