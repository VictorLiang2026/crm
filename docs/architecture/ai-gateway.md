# AI Gateway（共享模块第一阶段）

入口位于 `cloudfunctions/_shared/ai-gateway.js`。未来服务端调用者创建 `createAIGateway({ app, rdb })`，然后调用 `runAITask({ taskType, skill, capability, context, input, outputSchema })`。可选的 `subjectType` 与 `subjectId` 必须成对提供。`app` 是 CloudBase Node SDK 应用；`rdb` 必须是仅在服务端持有 API Key、以 `service_role` 身份访问 `public` 表的 CloudBase RDB。不要把 API Key、完整输入快照或运行时上下文返回浏览器。当前函数使用的匿名 RDB 通道无权访问 AI Runtime 三表，不能直接复用。

```js
const { createAIGateway } = require('./ai-gateway');
const { runAITask } = createAIGateway({ app: privilegedCloudBaseApp, rdb: privilegedCloudBaseApp.rdb() });
const draft = await runAITask({
  taskType: 'example_advice',
  skill: 'example_skill',
  capability: 'text',
  context: { facts: ['isolated example'] },
  input: { question: 'What should be reviewed?' },
  outputSchema: {
    type: 'object',
    required: ['recommendation'],
    properties: { recommendation: { type: 'string' } },
    additionalProperties: false,
  },
});
// draft.result is a proposal. A separate, authorized user action must confirm it.
```

模型由 `modelResolver({ taskType, skill, capability })` 选择；默认读取服务端 `AI_GATEWAY_MODEL`，为空时兼容回退到现有 `AI_MODEL` 环境变量。模型组由 `groupResolver` 或 `AI_GATEWAY_GROUP` 决定，默认使用 CloudBase 托管组 `cloudbase`。这里没有内置任何具体模型 ID、厂商或费用单价。CloudBase 的模型组和模型必须在接入前核对已启用状态；若没有配置模型，调用在落库前失败。`skill` 当前只是审计元数据，尚未装载任意外部提示词。

Gateway 先插入 `public.ai_tasks`，每次尝试先插入一条 `public.ai_runs`，再调用 CloudBase `generateText`。它把上下文和输入作为 JSON 快照保存；超时默认 60 秒，最多两次尝试，只重试限流、服务端故障和明确的连接故障。超时不重试，因为未取消的远端请求仍可能完成并产生费用。每次尝试记录成功状态、耗时、错误类别和实际返回的用量。`provider`、`model` 与 `cost` 仅在 SDK 响应提供时记录，否则为 `NULL`，不从配置猜测。SDK 返回文本必须是 JSON；`outputSchema` 只支持 `type`、`required`、`properties`、`items`、`enum`、`additionalProperties`，不支持的关键字在调用前拒绝。成功后写入一条 `public.ai_results`，`user_selected=false`、`user_edited=false`、`requires_confirmation=true`；Gateway 不修改客户、活动等业务数据。

审计写入失败时不调用模型或不重试已经完成的模型调用，也不返回成功。当前 CloudBase RDB 是多次独立请求，不能保证跨三表原子提交；网络故障可能留下 `running` 任务或尚未补全的 run。后续接入前需设计对账、幂等和授权调用入口。SDK 调用的本地超时不等于远端取消，实际计费以 CloudBase 返回为准。

本阶段不向现有 26 个函数同步或部署该文件，不改现有 `db.js` / `ai.js` 与 `AI_MODEL` 行为。现有 shared 同步脚本仍只治理 `db.js`、`ai.js`。首个实际调用者出现时，应单独审查服务端 API Key 存放、RLS 身份、模型配额、函数超时、重试幂等、敏感快照、人工确认和业务回归，然后将此文件复制到明确受影响的函数并只部署该函数。当前环境的 Token Credits 只读预检返回空列表，本轮不进行真实模型调用。
