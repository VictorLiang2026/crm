# WP08｜统一 Action 与 Commitment 的日常操作

范围：只在 Person 360 和 Today 增加现有 `public.actions`、`public.commitments` 的人工日常操作；保留 `public.v_action_center`、旧客户/招募/活动写入及 WP07 V2。未实施自然语言更新执行器或 WP09。

## 基线与影响

- 开始于本地、GitHub、云端一致的 `master` `ee2e9977896cd639ca96f48577862787f008fdd7`，回滚标签 `release-20261004-140000`。基线 `npm test` 为 94 通过、0 失败、5 项预设跳过。数据库变更前 `actions` 3 行、`commitments` 1 行，均为登记的虚构样本；`v_action_center` 166 行。
- 页面：`#/person/:id`、`#/today` 新增行动/承诺区域。入口通过现有 `callFn('person_360')`，Person 360 与 Today 读同一业务表；Today 旧建议与 `v_action_center` 保持原查询。成功写入后清除 Today AI 缓存并重新加载。
- 接口：`person_360` 新增 `listPersonWorkItems`、`listTodayWorkItems`、`previewWorkItem`、`executeWorkItem`；新的数据库函数 `public.crm_work_item_preview_v1`、`public.crm_work_item_execute_v1` 仅由服务角色调用。列表按 Person ID 精确关联，不按姓名合并。
- 字段：Action 使用既有 `title/description/due_at/priority/status/completed_at/completed_by_uid/updated_at`；Commitment 使用既有 `content/commitment_type/due_at/status/completed_at/completed_by_uid/updated_at`。来源字段保持原值，人工创建标记 `manual`。
- 数据：新增 `public.crm_work_item_commands` 保存账号、请求幂等键、Person、候选更改、原版本、15 分钟截止、确认结果与原业务 ID。预览只写这张台账；确认在同一事务中写业务表和回执。每条衍生测试业务行由现有样本触发器登记，不增加初始种子。
- 权限：台账强制 RLS，仅 `service_role` 可读写；新函数 `SECURITY INVOKER` 且仅授予服务角色执行。测试账号仅能操作同批次已登记、带 `【系统测试·勿联系】` 的虚构 Person 与业务项。人工选择 Person、服务端核实登录账号、版本和状态；不相信客户端 confirmed 标志。
- 兼容回归：登录/RLS、Person 360、Today、旧客户/招募/活动与跟进、回收站、WP07 V2。旧路由与旧表/视图未改；新增页面文件只按需加载。

## 数据库变更与回退

迁移：`cloudbase/migrations/20261004063000_work_item_commands.sql`；配套回滚：`cloudbase/rollbacks/20261004063000_work_item_commands.sql`。CloudBase `dryRun` 与 `planMigration` 先通过，再于 2026-10-04 执行 `applyMigration`，任务 `task-b026dc67`。迁移只新增 public 对象，未改基表列或依赖视图。回滚 SQL 如发现已执行回执会拒绝，必须先保留回执证据、评估衍生业务行；代码回退从起点标签恢复受影响页面和 `person_360`，通过新恢复提交推送，禁止强推或静默回滚数据。

## 验收记录

当前隔离回归 94 通过、0 失败、5 项预设跳过；WP08 专项 4 通过；公共权限目录 728 项通过、匿名网关 55/55 通过；WP04 身份覆盖审计保持原 6 项例外。`npm run test:wp01` 安全门槛为 `PASS_WITH_LIMITATIONS`。prtest 已在隔离窗口真实登录；`tests/wp08/live.cjs` 的服务端读取、虚构样本提示、Today 纳入、预览不写业务、重复预览同回执、伪造回执拒绝共 8 项通过。预览回执 `f20f508d-7314-4d1f-bab2-c69b28350220` 指向已有虚构 Action #7，未执行。

人工确认后，Action #7 回执 `e9ab1f31-1443-4af4-abb2-1ff072058a52` 与 Commitment #1 回执 `28abe916-d57a-4f7c-9121-ade8107acdaf` 均成功记录“已完成”、完成时间和操作者，原测试台账关联保留；`tests/wp08/confirmed-live.cjs` 各自 5/5 通过：Person 与 Today 状态及完成时间相同，重放返回原 ID 且不改变时间。人工新建 Action #8 与 Commitment #2：均为 `person_id=783`、状态 open、明天北京时间到期、来源 manual、文本带测试标记；现有触发器已将两个 ID 登记为衍生样本，`tests/wp08/state-live.cjs` 各自 3/3 通过。人工编辑两项到期时间为昨天，页面均显示“已逾期”，Person 与 Today 日期一致；两项随后分别撤销与重开，业务状态依次为 cancelled/open，两处读取一致，`completed_at` 与 `completed_by_uid` 均为空。`tests/wp08/rejection-live.cjs` 5/5 通过：过期预览、伪造 Person、跨 Person 行为 ID 均拒绝，业务状态不变。初始样本仍为 10 行。来源链接指向现有 Person 时间线；隔离浏览器 390px 宽度未横向溢出，真机未验证。

最终服务端列表优先按到期时间读取每类最多 50 条未结束项目，再补最近 10 条已结束项目，防止大量最近完成项目掩盖早期逾期项；超过窗口会明确提示。针对该边界的夹具复验通过。最终函数和模块重部署后，线上普通 Person/Today 服务确认 Action #8 和 Commitment #2 分别位列各自未完成类别首位，仍带测试标记。旧相邻模块真实只读回归：登录/权限及客户、活动、漏斗等 71/71、WP06 时间线 14/14、WP07.1 人物目录 16/16；WP07 V2 6/6 与旧服务 5/5 单测通过。

发布产物限定为 `admin.html`、`crm/js/modules/person-360.js`、新 `crm/js/modules/work-items.js`、新 `crm/css/work-items.css` 和 `person_360` 云函数；其余函数及旧路由无改动。新增仓库文件另有迁移/回滚、服务模块、WP08 专项/实测脚本、本报告及权限基线。线上地址仍为 `https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。数据库最终为初始样本 10 行、衍生样本 28 行、WP08 已执行回执 11 条，Action #8/Commitment #2 为本包新增，旧 `public.v_action_center` 仍为 166 行；未进行真实外发。真机未验证，390px 浏览器模拟通过。发布提交/标签及三端最终核对以本轮最终报告为准。
