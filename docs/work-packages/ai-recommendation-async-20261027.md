# 人物 AI 建议异步返回：工作包与发布记录

## 范围与基线

- 基线提交：`ca63ca21a5c4e73a0e1ae3f33bcc38978dd22026`；标签：`release-20261027-231500`。
- 目标：人物详情中的“AI摘要”和“双建议”在模型生成期间尽早返回任务 ID，页面通过已认证的状态接口轮询并展示原有结果。
- 数据范围：只读取 `public.ai_tasks`、`public.ai_results` 及摘要所需的现有上下文；没有数据库变更、迁移、权限调整或真实业务数据写入。
- 函数范围：`assistant`；AI Gateway 保持 `_shared`、`assistant`、`ai_activity` 三份代码一致。`ai_activity` 的调用不传新回调，既有同步行为不变。
- 页面范围：Console 数据模块和一个任务轮询 helper；摘要与双建议 UI、选择建议的人工作业流程不变。

## 行为与兼容

- 浏览器明确使用 `asyncWait: true` 时，非 async CloudBase handler 在 callback 前设置 `context.callbackWaitsForEmptyEventLoop=false`，先返回 `{status:"pending", taskId, personId}`；SCF 将响应与后台异步工作分离，Gateway 继续生成并写入原有审计结果。客户端每 3 秒查询一次 `assistant.aiTaskStatus`，最长等待 105 秒。
- 状态查询先验证登录，再按 task ID、任务类型、Person ID 限定读取；只有任务完成后才返回摘要或两条建议。
- 未传 `asyncWait` 的历史同步调用仍返回原有结果。Gateway 未传 `onStarted` 时保持原来调用方式。AI 结果仍只作为建议，双建议仍由用户选择，不触发业务写入。
- 回滚：回退本工作包的静态文件和 `assistant`、`ai_activity` 函数到基线版本并重新部署；不需要数据库回滚。

## 回归记录

- 语法检查：通过，覆盖 `assistant` 的入口、Gateway、摘要和知识库服务，Console 数据模块、轮询模块及 live probe 脚本。
- 定向异步与状态测试：11/11 通过，包含摘要与双建议早返回、旧同步兼容、任务查询校验、结果来源约束和 Gateway 任务回调。
- 知识库回归：19/19 通过；双建议浏览器交互 1/1 通过。
- 项目回归 `npm test`：108 PASS、0 FAIL、5 SKIP。跳过项为真实登录、线上数据库/AI/写入及真实移动设备，不属于隔离回归覆盖。
- 发布安全门 `npm run test:wp01`：`PASS_WITH_LIMITATIONS`，无 blocker。`public` 目录检查、匿名边界、WP02–WP06、PC34 和回归通过；登录证据过期，service runtime、线上写操作及真实移动设备视觉验收未验证。一次门禁运行曾因 Gateway 副本不同步失败；同步三份副本后复跑通过。
- 线上验证前两次均发现摘要调用跑满 CloudBase 函数 90 秒上限（RequestId `2e447f39-d220-11f1-b3b2-525400a30f5c`、`61ac9216-d221-11f1-b134-52540093365b`）；只读 `public.ai_tasks` 核验两次 AI 结果都已完成，说明后台运算结束但同步响应未提前返回。依据 [SCF Node.js callback 与异步特性文档](https://intl.cloud.tencent.com/zh/document/product/583/46770)，改为非 async handler，并仅对指定异步请求在 callback 前关闭 event loop 等待，以分离同步响应和后台异步处理。修复后的线上验证待重部署后执行。
- 线上业务验证：摘要和双建议均使用虚构 Person 783；不保存生成文本、不选择建议、不写客户资料。

## 发布检查

- 部署前：baseline 的本地、GitHub `master` 与 CloudBase 产物一致；完整发布前安全门通过但带有以上限制。
- 云端部署范围：仅 `assistant`、`ai_activity` 云函数，以及 `/crm/js/modules/console/data.js` 和 `/crm/js/modules/console/ai-task-polling.mjs`。
- 数据库：没有迁移或回滚 SQL。
- 首次 `assistant`、`ai_activity` 及两个前端文件已部署；首次线上验证发现 callback 兼容问题后，Git 发布流程已在提交前中止。修正后的 `assistant` 需重新部署。
- 提交、标签、修复后线上验证与最终 sync-check：待执行后补记。
