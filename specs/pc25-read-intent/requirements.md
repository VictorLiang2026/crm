# PC25 助手只读意图需求

## 目标

让 Console AI 助手成为有限只读任务入口：先识别意图和目标，再调用已有执行器；明确区分只路由与已执行。

## 支持矩阵

| 意图 | 执行器 | 人工决策 |
| --- | --- | --- |
| search | PC24 `searchV2` | 模糊姓名必须选 Person；结果来源/分页沿用 PC24 |
| summarize | 既有人物摘要服务 | 选择姓名解析出的 Person |
| prepare | 既有 Meeting Prep 服务 | 选择姓名解析出的 Person |
| plan | 既有 `today_coach.daily_review(view=morning)` | 人物引用不自动选；当前范围是今日计划 |
| analyze | 未接入 | 明确拒绝并标记未执行 |

## 验收

1. 未知或不确定意图不能默默选择。服务端返回有限选项；选择前不执行 CRM 业务查询。
2. 模型只输出枚举意图和可选姓名短语，不能输出 Person ID、SQL 或业务名单。
3. 模糊姓名先由服务端 `PersonService.resolveName()` 返回候选，人选定后服务端再次解析并绑定候选。
4. 响应显示意图、解释、数据范围、是否完成执行、来源和准确执行标志；`routed` 不等于已执行。
5. AI 与 CRM 数据源错误、无结果、权限错误及超时均以失败或未知状态显示，不能伪造成空结果。
6. 只读能力可以写 AI 审计，但不得写 Person、Fact、Opportunity、Action 或业务状态。
7. 未接入的分析明确拒绝。旧显式 action 与纯 `intent-router` 响应保持兼容。

