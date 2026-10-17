# PC25 助手只读意图设计

## 路由与执行

- 新增隔离 action `assistantReadTask`，由 `assistant` 已有真实登录门禁保护。纯 `action=intent` 路由仍返回原 `status=routed` 契约。
- `assistant_read_intent_v1` 通过既有 AI Gateway 与 CloudBase 配置模型解析；结构限定为状态、有限意图、解释、姓名短语和有限澄清选项。
- `search`、`summarize`、`prepare`、`plan` 直接调用现有服务；不复制查询/上下文构造器。`analyze` 明确拒绝。
- `summarize` / `prepare` 要求姓名短语；服务端解析候选。选择后重新解析意图及姓名并核验候选 ID。人物未确认前不加载该人物上下文。
- 所有异常向外转换为受限错误码。完成响应携带任务计划、数据范围、底层既有执行器结果和 `businessDataWritten=false`。

## 兼容与影响

- 只新增 `assistantReadTask` action；旧 `search`、`searchV2`、`summarize`、`meetingPrep`、Today Morning Brief 和 Intent Router 输出不改。
- UI 只在既有 AI 页面增加统一只读任务卡片；旧 AI Search 卡片保留。
- 无数据库 migration，不新增角色或浏览器数据库权限。

