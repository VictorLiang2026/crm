# AI Gateway（共享模块第一阶段）

入口位于 `cloudfunctions/_shared/ai-gateway.js`。未来服务端调用者创建 `createAIGateway({ app, rdb })`，然后调用 `runAITask({ taskType, skill, capability, context, input, outputSchema })`。可选的 `subjectType` 与 `subjectId` 必须成对提供。`app` 是 CloudBase Node SDK 应用；`rdb` 必须是仅在服务端持有 API Key、以 `service_role` 身份访问 `public` 表的 CloudBase RDB。不要把 API Key、完整输入快照或运行时上下文返回浏览器。当前函数使用的匿名 RDB 通道无权访问 AI Runtime 三表，不能直接复用。

```js
const { createAIGateway } = require('./ai-gateway');
const { runAITask } = createAIGateway({ app: privilegedCloudBaseApp, rdb: privilegedCloudBaseApp.rdb() });
const draft = await runAITask({
  taskType: 'capture',
  skill: 'quick_capture',
  capability: 'structured_extraction',
  context: {},
  input: { text: 'Call the customer tomorrow' },
});
// draft.result is a proposal. A separate, authorized user action must confirm it.
```

模型由 `modelResolver({ taskType, skill, capability })` 选择；默认读取服务端 `AI_GATEWAY_MODEL`，为空时兼容回退到现有 `AI_MODEL` 环境变量。模型组由 `groupResolver` 或 `AI_GATEWAY_GROUP` 决定，默认使用 CloudBase 托管组 `cloudbase`。这里没有内置任何具体模型 ID、厂商或费用单价。CloudBase 的模型组和模型必须在接入前核对已启用状态；若没有配置模型，调用在落库前失败。`skill` 必须在 [Skill Registry](ai-skill-registry.md) 注册；Registry 定义能力、上下文配方、输入输出契约、确认级别与超时类别，不装载模型配置或任意外部提示词。

Gateway 使用 Registry 的 JSON Schema 在落库前校验输入和上下文，并在模型返回后校验结构化输出。调用者可以省略 `outputSchema`；如传入则必须与注册版本完全相同，不能用临时 Schema 绕过约束。Gateway 先插入 `public.ai_tasks`，每次尝试先插入一条 `public.ai_runs`，再调用 CloudBase `generateText`。它把输入和上下文作为 JSON 快照保存，并在上下文快照中记录 Skill 名称及版本；超时由 Skill 类别决定（短 30 秒、标准 60 秒、长 120 秒），最多两次尝试，只重试限流、服务端故障和明确的连接故障。超时不重试，因为未取消的远端请求仍可能完成并产生费用。每次尝试记录成功状态、耗时、错误类别和实际返回的用量。`provider`、`model` 与 `cost` 仅在 SDK 响应提供时记录，否则为 `NULL`，不从配置猜测。成功后写入一条 `public.ai_results`，`user_selected=false`、`user_edited=false`、`requires_confirmation=true`；Gateway 不修改客户、活动等业务数据。

审计写入失败时不调用模型或不重试已经完成的模型调用，也不返回成功。当前 CloudBase RDB 是多次独立请求，不能保证跨三表原子提交；网络故障可能留下 `running` 任务或尚未补全的 run。后续接入前需设计对账、幂等和授权调用入口。SDK 调用的本地超时不等于远端取消，实际计费以 CloudBase 返回为准。

当前 `assistant` 与 `ai_activity` 函数目录各保留一份 Gateway 副本；`assistant` 用它处理人物摘要和知识库双建议，`ai_activity` 的既有调用仍保持原行为。共享副本 `_shared/ai-gateway.js` 与这两个副本必须保持一致。Gateway 的可选 `onStarted` 回调在任务和首个 run 审计创建后、模型请求前通知调用方任务 ID；未传回调时不改变同步调用行为。人物摘要和双建议通过 CloudBase 函数 callback 尽早返回任务 ID，再由已认证的 `assistant.aiTaskStatus` 读取 `public.ai_tasks` / `public.ai_results` 完成轮询。仅在这两个明确启用的异步请求上，使用非 async handler 并在 callback 前设 `context.callbackWaitsForEmptyEventLoop=false`，由 SCF 分离同步响应与后台异步工作；其他调用仍受支持并继续返回原 Promise。此流程复用现有表，不新增数据库对象，也不自动确认或执行建议。模型仍由 AI Gateway / CloudBase 配置决定，建议选择仍由用户完成。

本接入的回归重点是 Gateway 副本一致、早返回与后台审计完成、状态查询按任务类型和 Person 限定、旧同步接口兼容，以及人物详情双建议交互。线上 AI 生成验证使用登记的虚构 Person 783；未执行真实客户写入。
