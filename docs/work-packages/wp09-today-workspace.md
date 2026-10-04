# WP09｜Today 成为统一工作台

范围：只调整 `#/today` 的晨间事实工作台与测试场景入口。旧 Today 5、旧 `daily_review`、WP08 行动/承诺写入和后续工作包均不改。专项范围已在编码前获得用户确认。

## 基线、影响与兼容

- 起点：`master` `825703293315ce83c80ee8c69c9dbfaa0cb80ab3`，回滚标签 `release-20261004-155918`。修改前 `tools/sync-check.ps1` 证实本地、GitHub、云端页面及 28 个 CRM 函数源码一致。
- 页面：`#/today` 的 Morning Brief 进入即从当前数据库事实生成七段，按钮可刷新事实或按需取得 AI 工作建议。`#/test-scenario` 增加“一键打开测试日程”，仍打开普通 Today 查询，没有隐藏测试数据或新增种子。Person 360、Today 5、旧复盘、旧客户/招募/活动/回收站路由保持原入口。
- 并发：行动或承诺状态改变会触发晨间事实刷新；前端只接受最新一次请求的响应，避免先发出的旧读取晚到后覆盖当前状态。
- 接口：沿用 `callFn('today_coach', {action:'daily_review', view:'morning'})`。新增可选 `guidance:'rules'` 参数跳过模型，仅按规则返回事实；原不带 `view` 的 `daily_review` 与 `generate` 契约不变。WP08 行动状态改变后刷新晨间事实。
- 字段：只读取 `public.actions` 的 ID、Person ID、标题、截止时间、状态、来源与六维排序值；`public.commitments` 的 ID、Person ID、内容、截止时间与状态；现有 `public.v_action_center`、活动、正式机会和待审核机会候选作为只读来源。页面不展示电话或其他联系信息。
- 数据：本包不写业务表、不增加初始样本，也不添加数据库结构。无 migration/rollback；旧的 10 条初始虚构样本保持不变。含测试数据提示沿用受保护台账的服务端摘要，显示数量与来源，不从普通查询排除样本。
- 权限：`today_coach` 先核实非匿名登录；敏感 Person/行动/承诺/候选读取仅在服务端经现有服务角色执行，浏览器不持有数据库密钥。未扩大 `anon` 或 `authenticated` 权限。线上 `public` 权限目录只读核查：Actions、Commitments、Opportunity Candidates、Persons 对两角色均无直接 SELECT；既有活动、机会和旧行动视图权限未改。
- 兼容与回归范围：登录与 RLS、Today 5、旧今日/近七日复盘、WP08 行动与承诺状态、Person 360 精确定位、客户/招募/活动与跟进、漏斗、回收站及 WP07 V2。来源 ID 去重在 Morning Brief 展示层执行；原 Today 5 候选算法未调整。

## 事实、排序与限制

七段为 Morning Brief、Top Actions、Commitments、Upcoming、Risk、Opportunities、Need Confirmation。Top Actions 由既有六维规则分排序，同分按截止日期及行动来源 ID 稳定排序；页面给出规则分、为什么现在处理、来源和北京时间截止。正式机会与待确认候选分区显示，不把候选当成正式事实。承诺以当前时刻区分逾期和未来三天到期，不只按当天零点切分；活动与行动按可解析的截止时刻排序。统一 Action/Commitment 链接可滚动定位 Person 360 的对应业务行。

读取沿用现有服务端字段裁剪与候选上限：开放 Action 最多 1000 行，承诺逾期/到期各读取 51 行显示 50 行，机会读取 51 行、待确认候选读取 21 行并提示截断。旧视图候选若达到 SDK 的 1000 行读取边界会明确报错而非假装完整。没有 AI 时仍返回事实和规则建议；AI 只能从预设建议中选择，不能修改日期、人物、行动或来源。

## 验证与发布

修改前 `tests/today-coach` 9/9 通过；代码调整后的专项测试 10/10 通过，覆盖登录拒绝、仅 public 受限读取、事实七段、AI 不改事实、来源去重和北京时间截止。首轮浏览器回归因测试仍断言“按需生成”旧按钮而失败，更新断言后通过。新增“一键打开测试日程”及精确跳转的隔离浏览器用例；一次 Person 360 家庭卡片超出 6 秒等待，在无并行云端核对负载时复验通过。最终完整回归 95 通过、0 失败、5 项预设跳过；浏览器单跑 59 通过、0 失败、6 项条件性跳过。WP01 发布门槛为 `PASS_WITH_LIMITATIONS`，public 权限目录 728 项及匿名网关 55/55 通过。第一次最终门槛因目录和身份快照过期被阻断，重新从 public 只读采集后复跑通过；已登记的 6 项 WP04 身份例外未扩大。

部署后 `tools/sync-check.ps1 -CloudOnly` 证实页面与 24 个引用静态资源、28 个 CRM 云函数的 164 个源码/配置文件均与本地一致。线上只读数据计数为 Actions 4、Commitments 2、活动 12、机会 7、待确认机会候选 0、旧行动视图 166；受保护测试台账初始行仍为 10。待确认候选有值分支由不落库夹具验证。真实测试账号登录脚本仍待本轮结果文件，发布门槛明确记为 `MANUAL_LOGIN`；服务角色运行时、线上写入、真实 AI 和真机未验证。本包未触发任何业务写入或外发。

仅部署 `admin.html`、`crm/js/modules/morning-brief.js`、`crm/js/modules/test-scenario.js`、`crm/css/morning-brief.css` 与 `today_coach` 函数。新增仓库文件为本报告；修改的测试夹具与用例仅用于回归。代码回退从起点标签取回本包变更文件，重新部署受影响产物并创建恢复提交；本包没有数据库数据或结构回滚。线上地址：`https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。Git 提交、标签与最终三端一致性在收尾时补记。
