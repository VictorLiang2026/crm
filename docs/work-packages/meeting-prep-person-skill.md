# meeting_prep Person Skill 2.0（2026-09-29）

## 范围与基线

- 修改前本地/GitHub HEAD `dad2801434ab0235eac55d8eed63c83dbde93293`，标签 `release-20260929-062707`，工作区干净；27 个 CRM 函数及线上页面与本地一致。
- 原 `meeting_prep` 1.0 只是未被生产函数导入的契约：必需 `goal`，旧 Context Engine 按 `customer` 读取。原 `meeting_prep` Context Engine recipe 保留供 Legacy 读取，但其结果不再宣称符合 Person 版 2.0 Skill 契约；不改旧客户流程。
- 本轮只升级 Skill Registry 契约并新增只读 Person Context Builder；不新增页面、表、权限或模型调用，不写 CRM 业务记录或 AI 审计记录。

## 契约与读取

- 输入仅 `person_id`（正整数或十进制正整数字符串），版本 2.0.0；输出七项：`brief30Seconds`、`recentChanges`、`suggestedObjective`、`openingAngles`、`possibleObjections`、`questionsToConfirm`、`avoid`。结果须供人审阅，不产生业务写入。
- Context Builder 只通过注入的已授权 `GET` 请求读取 `public`：Person、家庭及已确认成员、双向关系、统一与 Legacy 互动投影、已确认 Fact、Signal、开放机会、开放 Action、开放 Commitment；保险数据复用 `InsuranceContextService`。数组分别限制在 6 至 10 条，字段裁剪并附来源。
- 未确认 Fact Candidate 不进入 Facts；Signal 仍标记确认状态。互动的原始笔记不进入上下文。已关闭机会、过期 Context Item 不进入有效上下文。
- 仓库没有 Playbook 内容源，`relevant_playbook` 返回 `unavailable`，不从人物资料臆造话术。

## 验证与发布

- 虚构数据单元测试验证输入/输出 Schema、11 段上下文、来源、上限、Fact/Signal 区分、无写操作与缺失 Person 拒绝。
- 定向测试 3 通过；Context Engine / Gateway / Registry 联合测试 19 通过；Gateway 专项 11 通过；完整 CRM 回归 68 通过、0 失败、5 跳过。该构建器尚无生产调用入口，因此没有真实模型生成或真人审阅验证。
- 云端只同步 `person_360` 函数包中的新只读模块；当前函数入口不调用该模块，线上旧行为不变。部署后未登录直调原 `get` 返回 `UNAUTHORIZED`，证明原入口仍可运行且拦截未授权请求。回滚使用前一发布标签恢复对应函数包与 Registry 源码；无数据库回滚。
