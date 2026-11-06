---
name: update-gpt-followup-advice
description: Use when the user asks to create or update missing CRM GPT follow-up advice. Uses complete, authorized Person and knowledge context, then requires server preview and explicit human confirmation for every saved record. / 当用户要求补充 CRM GPT 跟进建议时使用；读取完整且已授权的人物与知识上下文，并对每条记录先做服务端预览、再由人明确确认后保存。
---

# Update GPT Follow-up Advice / 更新 GPT 跟进建议

## Authorization and scope / 授权与范围

- Use only the CRM Assistant MCP tools: `followup_gpt_task_package`, `knowledge_record_get`, `followup_gpt_import_preview`, and `followup_gpt_import_confirm`.
- Never call `followup_gpt_advice_save`. It bypasses the review step and is outside this Skill's workflow.
- The required scopes are `followup:read`, `knowledge:read`, and `followup:gpt:submit`. A missing scope or tool is a stop condition; do not fall back to CloudBase, SQL, HTTP, browser automation, or another integration.
- Preserve the system advice. This workflow writes only the matching empty GPT advice fields after the user approves the exact preview.
- Do not access `pr` schema, `pr_*` objects, or `pr_*` Cloud Functions.

- 仅使用 CRM Assistant MCP 工具：`followup_gpt_task_package`、`knowledge_record_get`、`followup_gpt_import_preview`、`followup_gpt_import_confirm`。
- 不调用 `followup_gpt_advice_save`；该工具跳过本 Skill 要求的审核步骤。
- 需要 `followup:read`、`knowledge:read`、`followup:gpt:submit`。缺少工具或 scope 时停止，不回退到 CloudBase、SQL、HTTP、浏览器自动化或其他连接。
- 保留系统建议；只有用户批准了对应的准确预览后，才写入同一记录中为空的 GPT 建议字段。
- 不访问 `pr` schema、`pr_*` 对象或 `pr_*` 云函数。

## Load complete context / 完整读取上下文

1. Use the exact `personId` supplied by the user when available. Otherwise page with `followup_gpt_task_package` using `afterId` and `limit` no greater than 10. Continue only while `nextAfterId` advances; do not claim full completion until the server reports the end of the result set.
2. Process only records returned by CRM as ready with both GPT fields empty. Keep each exact `adviceId`, `personId`, and `systemVersion` attached to its own result.
3. Verify that the response contains all required fields for Person context, system advice, recent interactions, and both knowledge-source groups. A present empty value is a fact; a missing field, truncation, incomplete page, or unclear identity is not.
4. Read every referenced knowledge record with `knowledge_record_get` using the exact table and ID from the package. Use only its complete stored system original and GPT summary. An excerpt or partial page is not a substitute.
5. If any required context or source cannot be fully loaded, stop that affected record. Do not guess IDs or fill missing facts.

1. 用户提供了精确 `personId` 时，只读取该人物。否则通过 `followup_gpt_task_package` 使用 `afterId` 分页，每页 `limit` 不超过 10；仅在 `nextAfterId` 向前推进时继续，并且只有服务端明确返回末页后才能称全部处理完毕。
2. 只处理 CRM 返回为 ready 且两个 GPT 栏位都为空的记录。每条候选内容都必须绑定原始 `adviceId`、`personId` 和 `systemVersion`。
3. 核实人物上下文、系统建议、近期互动和两组知识来源字段完整返回。字段为空可视为已知事实；字段缺失、截断、分页不完整或身份不清时不能继续。
4. 使用任务包中的精确表名和 ID 调用 `knowledge_record_get` 读取每个引用的知识记录。只使用完整的系统原文和 GPT 摘要；excerpt 或部分页面不能代替完整原文。
5. 必要上下文或来源未完整加载时，停止该条；不得猜测 ID 或补造事实。

## Draft and preview / 生成候选并预览

1. Draft a concise, practical recommendation based only on loaded facts. Separate facts, suggestions, and questions requiring verification. Do not invent needs, intent, budget, product terms, returns, guarantees, company policy, legal conclusions, or tax conclusions.
2. `overallStrategy` is for relationship progress and the next conversation step. `productServiceAdvice` may name a specific product or service only when complete approved sources support it; otherwise state what needs verification.
3. Use only exact integer source IDs returned for this Person. Use empty arrays when no source supports a section.
4. Submit candidates to `followup_gpt_import_preview`. This creates a short-lived preview; it does not save advice. Read the returned preview and its validation results.
5. Show the user, for each row, the Person, advice record, version, and complete proposed GPT fields. Do not treat “update all” or an earlier broad instruction as approval of unseen text. Ask the user to approve each previewed row explicitly.

1. 只依据已读取的事实生成简洁、可执行的建议；区分记录事实、建议和待核实问题。不得编造需求、意向、预算、产品条款、收益、保证、公司政策、法律或税务结论。
2. `overallStrategy` 描述关系推进和下一步沟通。只有完整且已批准的来源明确支持时，`productServiceAdvice` 才能给出具体产品或服务；否则说明待核实事项。
3. 来源 ID 必须是 CRM 为该人物返回的精确整数。某段没有依据时对应来源数组留空。
4. 使用 `followup_gpt_import_preview` 提交候选。此操作只创建短时预览，不保存建议；读取并检查服务端返回的预览与校验结果。
5. 对每条记录向用户展示人物、建议记录、版本及完整 GPT 建议文本。用户只说“全部更新”或之前给过宽泛指示，不代表批准尚未展示的文本；必须逐条取得明确确认。

## Confirm and verify / 确认并核验

1. After explicit approval of one preview row, call `followup_gpt_import_confirm` with that exact `adviceId`, `personId`, `systemVersion`, and `previewId`. Never send a client `confirmed` flag.
2. Confirm one row at a time. Do not confirm rows the user skipped, rejected, or did not clearly approve.
3. The server must recheck the operator, preview, expiry, Person/advice link, system version, ready status, empty GPT fields, and approved sources. Treat a stale preview or failed validation as a stop for that row; do not blindly retry.
4. Report only rows with a successful `saved` result as saved. Summarize saved, skipped, and failed counts, pagination completeness, and concise failure reasons. Do not repeat Person context in the report.
5. Do not edit Person data, system advice, knowledge records, or any other CRM fields.

1. 用户明确批准某一条预览后，才用该条准确的 `adviceId`、`personId`、`systemVersion` 和 `previewId` 调用 `followup_gpt_import_confirm`。不发送客户端 `confirmed` 标志。
2. 逐条确认。跳过、拒绝或未明确批准的记录不得确认。
3. 服务端必须重新核对操作者、预览、过期时间、人物/建议关联、系统版本、ready 状态、GPT 栏位为空及来源有效性。预览过期或校验失败时停止该条，不盲目重试。
4. 只有回执为 `saved` 才报告保存成功；汇总成功、跳过、失败数量、分页完整性及简要原因，不复述人物上下文。
5. 不修改 Person 资料、系统建议、知识记录或 CRM 其他字段。
