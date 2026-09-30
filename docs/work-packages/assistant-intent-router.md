# Assistant Intent Router V1

基线：`6da9f5ac40d0a946ac2ef9ac5ada9086a5bd0122` / `release-20260930-114944`。修改前本地、GitHub、线上页面及 27 个 CRM 云函数一致。新增独立 `assistant` Event Function；不修改旧页面、旧函数、数据库、路由或模型配置。

本版不是聊天机器人，也不会从自然语言猜测意图。调用方必须显式传入 `intent`、相应的 `subject` 和 `input`。函数先核验真实 CloudBase 登录，再按白名单校验并返回统一路由计划。任何响应的 `execution.performed`、`modelCalled`、`businessDataRead`、`businessDataWritten` 都是 `false`；它不会调用模型、查询 CRM 数据或创建/更新候选。不要把 `status: "routed"` 解释为任务已执行。

| intent | subject.type | 预定 Skill / 能力 | 必要输入 |
| --- | --- | --- | --- |
| `search` | `none`（可省略） | `ai_search` / retrieval | `query` |
| `summarize` | `person` | `person_summary` / summarization | 无 |
| `prepare` | `person`、`activity` | `meeting_prep`、`activity_prepare` / planning | 无 |
| `analyze` | `opportunity`、`activity` | `opportunity_analysis`、`activity_review` / analysis | 无 |
| `plan` | `day`（`YYYY-MM-DD`） | `today_coach` / planning | 无 |
| `create_candidate` | `none`、`person`、`activity`、`opportunity` | 待接入的候选预览执行器 | `candidateType`、非空 `draft` |
| `update_candidate` | 同上 | 待接入的候选预览执行器 | `candidateType`、`candidateId`、非空 `changes` |

候选类型仅允许 `person`、`interaction`、`fact`、`signal`、`inference`、`opportunity`、`action`、`commitment`。`create_candidate`/`update_candidate` 必须由未来执行器保留人工确认；Person 执行器还必须遵守 `PersonService.resolveName()` 的身份确认规则。本版只有路由契约，既不调用 Quick Capture，也不复用旧匿名数据通道。输出不回显输入正文和登录 UID。未知意图、超长或不匹配的输入、匿名调用均拒绝。

例子：

```json
{"intent":"prepare","subject":{"type":"person","id":"7"},"input":{"objective":"会前梳理"}}
```

成功响应包含 `route.key`、`route.skill`、`route.contextRecipe`、`route.capability`、`route.subject`、`route.confirmationLevel`，并明确标记未执行。后续接入任何实际数据查询、模型调用或业务写入，必须另做权限和人工确认设计及回归。本轮无数据库迁移和回滚需求；若要撤下新函数，先停止调用，再按项目规则单独批准删除云资源。

验证记录（2026-09-30）：路由单元测试 5/5 通过，覆盖七种意图、匿名拒绝、无效输入、敏感正文不回显及 CloudBase 事件附加字段。真实测试账号通过独立浏览器调用线上 `assistant`，得到 `search.none`，且四个执行标记均为 `false`；未读取 CRM 业务数据或调用模型。旧功能回归 `npm test`：82 通过、0 失败、5 跳过，覆盖登录、客户、Person 360、Today、活动、增员与回收站。只对 `assistant` 部署代码；旧页面和旧函数云端产物保持不变。发布前后再执行本地、GitHub 与云端源码一致性核对。
