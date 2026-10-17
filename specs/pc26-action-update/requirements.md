# PC26 Action 自然语言更新与完成

## Goal

在既有 Action create 命令之外，增加受限的 Action update 与 close 执行能力。自然语言只表达请求；目标 Person、目标 Action、数据库预览、人工确认和一次性执行都由显式服务端流程约束。

## User stories

- 作为已登录顾问，我可以用中文或英文描述要更新/完成的行动，并看到系统识别的操作与目标线索。
- 在同名 Person 或多个 Action 匹配时，我可以手动选定具体 Person 与 Action；系统不替我选择。
- 我可以核对数据库重读生成的 Action 前后值，确认后才执行。
- 如果记录版本、状态、授权或预览有效期变化，系统拒绝执行并要求重新规划。

## Acceptance criteria (EARS)

1. When a user submits natural-language text, the system shall produce only a finite `update`/`close` operation, Person name phrase, Action title phrase, and allowlisted field values; model output shall never contain target IDs or SQL.
2. When the parsed Person phrase is ambiguous, the server shall resolve candidates with `PersonService.resolveName()` and require explicit human selection before reading that Person's Action list.
3. When the user chooses a Person, the UI shall show that Person's open/in-progress Actions and require a human to select the exact target Action, including when there is only one candidate.
4. When an Action command is planned, the server shall bind the authenticated actor, exact Person, exact Action, operation, permitted field changes, version and 15-minute expiry in the existing command ledger.
5. When preview is requested, the server shall re-read the Person and Action, verify their relationship, active status and authorization, and return the actual before/after values and impact scope.
6. When the user has not confirmed the matching server preview, the system shall reject execution and perform no business write.
7. When a confirmed update is executed, the database shall atomically update only `action_type`, `title`, `description`, `due_at`, and/or `priority`; omitted fields remain unchanged.
8. When a confirmed close is executed, the database shall transition only `open` or `in_progress` to `completed` and set `completed_at` and `completed_by_uid` from server time and authenticated actor.
9. When the Action or Person version/status changes, the authorization expires, the target crosses Person scope, the payload includes another field, or a command is replayed, the system shall reject or return the prior result without a duplicate write.
10. When an update/close command fails, legacy Action create, PC06 manual Person/Today edit and completion, Today read refresh, and existing command/router contracts shall remain available with unchanged semantics.
11. The system shall not expose Commitment, Opportunity, delete, reopen, cancel, arbitrary status, bulk update, or other Action fields through this package.
12. All new interface text shall use the Console i18n dictionary with Simplified Chinese default and English support; layout and browser acceptance target iPad portrait and landscape.

## Non-goals

- No real customer Action is changed during validation.
- No write to Person, Opportunity, Commitment, Outcome or any other business object.
- No bulk operations, delete, reopen, or direct browser database access.
- No change to existing `assistant_action_command_v1` create payload/results or PC06 manual UI/API behavior.
