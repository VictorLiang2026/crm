# PC27 Opportunity 自然语言更新与关闭

## Scope

为已登录用户增加一个受控的自然语言 Opportunity 更新/关闭入口，复用 AI Gateway 配置的模型、Person 身份解析和 PC15 的 Person-only Opportunity 工作流。仅操作用户手动选定的、未关闭的 Person-only Opportunity。

允许的编辑字段是 `type`、`progress`、`nextAction`、`nextActionDate`；阶段变更仅允许现有 Opportunity 类型对应的阶段；关闭仅允许结果状态“成交”或“关闭”，且必须由用户提供结果说明。关闭会新增一条 Outcome。

## User stories

- 我可以用中文或英文描述要更新、推进或关闭的机会。
- 我可以手动选择 Person 与确切 Opportunity，AI 不会替我确定任何数据库身份。
- 我可以核对服务端重读生成的前后差异，并在单独确认后执行。
- 如果记录变化、权限/范围不符、预览过期或确认无效，系统会拒绝执行。

## Acceptance criteria (EARS)

1. When natural language is parsed, the system shall produce only `edit`, `stage`, or `close`, a Person phrase, an Opportunity phrase, and allowlisted values; it shall never produce target IDs, SQL, Action links, or arbitrary status.
2. When a Person phrase resolves to candidates, the user shall manually choose a candidate before the Opportunity list is read.
3. When a Person is selected, the system shall list only active Person-only Opportunities belonging to that Person and the user shall select the exact target, even when there is one candidate.
4. When editing, the server shall accept only `type`, `progress`, `nextAction`, and `nextActionDate` with existing PC15 validation and type rules.
5. When changing stage, the server shall enforce the current Opportunity type's allowed progression and reject terminal, cross-type, or unsupported statuses.
6. When closing, the user shall select `成交` or `关闭` and provide a non-empty result; the server shall create exactly one matching Outcome only after confirmation and successful execution.
7. When previewing, the server shall reread Person and Opportunity and bind actual before/after values, actor, target, payload, current record versions, and the existing 15-minute expiry.
8. When the user has not explicitly confirmed the stored, server-verified preview, execute shall make no business write.
9. When an Opportunity or Person changes, authorization expires, the target is not Person-only/in-scope, the payload is forged, or a command is replayed, the system shall reject or return the prior result without a duplicate write.
10. When this path fails, the existing PC15 manual Person-only workflow, legacy customer Opportunity read-only behavior, and existing `person_360` workflow API shall retain their semantics.
11. The UI shall be Simplified Chinese and English through Console `t(key)`, default Simplified Chinese, and support iPad portrait and landscape.
12. Regression shall use fictional registered fixtures only; no real Opportunity/Outcome is written.

## Non-goals

- Legacy customer Opportunities, create, delete, reopen, Action linking, Commitment, arbitrary status, or bulk operations.
- Changes to PC15 manual UI, customer Opportunity endpoints, existing Opportunity status definitions, or historical rows.
- Hardcoded AI provider/model or production model invocation for regression.
