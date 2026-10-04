# WP07 Quick Capture V2 确认写入

状态：WP07 功能与真实账号验收完成；本记录随最终文档发布生效。专项范围已获用户确认。本工作包只对 allowlist 中的测试账号启用 V2；旧 Quick Capture 和旧 V2 函数保持可用。

2026-10-04 验收补充：`release-20261004-014300` 已发布并通过三端源码核对。真实 `prtest` 会话下，预填场景和相邻 WP06 只读回归 14/14 通过，CloudBase 模型已真实返回候选草稿。随后发现解析成功但尚未 Plan 的 AI task/run/result 不在测试批次台账；本工作包增加解析成功后的场景状态核验与即时审计记账。已对本轮 4 组、共 12 条虚构 AI 审计台账行先 dry-run，再按精确 ID `8`–`11` 幂等补记并逐组只读核对；初始业务样本仍为 10 条。若审计关联失败，页面给出 AI task ID 并阻止用户继续，便于追查。该补充仅改变 V2 解析入口及错误提示，不修改旧 Quick Capture、数据库结构或真实外发。

真实写入复验：用户在本机登录 `prtest`，手动选择 Person #783，并在服务端预览核对仅含虚构内容。命令 `e3688a02-cbd4-4dbf-b844-de0fb52a96f6` 在人工确认前为 `previewed`，业务 ID 为空；人工点击确认后为 `executed`，写入 Interaction #6、默认未确认的 Context #3/#4 与 Commitment #1。AI task/run/result #11 及全部衍生行已逐 ID 登记到同一测试批次；重放相同命令只返回原 ID。随后第二次解析生成 AI task/run/result #12，解析结束即全部登记；行动候选的第二个命令 `d444a974-30f1-4d60-ab75-1ed8ebddebf5` 在服务端预览时只有 1 条“整理反馈”行动，尚无业务 ID。两次均未增加初始 10 行。

2026-10-04 剩余验收：上述第二个命令在 15 分钟内未获确认而过期，保持 `previewed` 且业务 ID 为空，证明未确认不写库。重新登录 `prtest` 后，用相同预填虚构场景经 CloudBase AI 生成 task/run/result #13，解析后立即逐条登记；用户再次手动选择 Person #783、只勾选“整理反馈”行动并核对服务端预览。命令 `07002d9e-4ee8-4808-ab47-df7f48b0a011` 在确认前无业务 ID，人工确认后为 `executed`，生成 Interaction #7 与 Action #7；行动标题含 `【系统测试·勿联系】`，本人确认 UID、来源及测试批次关联正确。重放该命令仅返回原 ID，Action、Interaction、命令各恰为 1 行。台账累计初始 10、衍生 8、AI 审计 21；没有真实外发。独立真实账号只读检查 67/67 通过，包含登录、RLS 拒绝、Today 普通候选测试来源、客户/活动/漏斗路由与 390px 场景页面；Person 时间线 14/14 通过。V2 弹窗在 390px 浏览器模拟下可关闭且无横向溢出，实际手机设备未验证。

## 基线与影响

改动前本地与 GitHub master 为 `1bf2b9099a64adf6a96a9056a5999dffb2eef085`，回退标签 `release-20261003-215500`；先前完整源码核对通过。本轮重新读取根 `AGENTS.md`、环境与安全边界及目标 CRM 三份规格文档。新代码只涉及 `admin.html` 的 V2 入口、`crm/js/modules/quick-capture-v2.js`、对应 CSS、`assistant` 函数和 `public` 的两条新迁移。无旧路由、旧表、旧函数的删除或重命名；未改模型厂商选择、登录、软删除和外发通道。

新接口为 `assistant.quickCaptureV2` 的 parse、resolve、plan、preview、confirm、execute 阶段。服务端核验真实登录与 `CRM_TEST_SEED_UIDS`，经 `PersonService.resolveName()` 取得候选，用户显式选择测试 Person。AI Gateway 读取 CloudBase 配置模型并生成带 task/run/result ID 的候选草稿；事实候选默认不勾选，确认后写入的 Fact/Signal 仍为未确认。Plan 在 `public.quick_capture_v2_plan_v1` 中先验证人物、草稿和 AI 审计，再与审计关联一起提交；失败时事务回滚。Preview 绑定账号、人物、版本与 15 分钟有效期，Confirm 必须提交服务端 hash，Execute 使用同一命令 ID 事务写入 Interaction、Context Item、Action、Commitment，并返回逐条 ID；重复 Execute 只返回原结果。机会候选仅展示，不在本工作包写入。所有写入仅关联已登记虚构 Person，初始 10 条样本不增加，不触发真实外发。

数据库新增 `public.quick_capture_v2_commands` 与两个受限 RPC。命令表启用并强制 RLS，仅 service_role 可读写；RPC 仅 service_role 可执行，匿名与 authenticated 无权访问。没有改已有表字段、视图或权限。迁移 `20261003163401_quickcapture.sql` 及 `20261003170000_quickcapture_atomic_audit.sql` 已应用，均有同名 rollback；计划表在上线前为空。回滚原子计划函数可独立执行；主回滚若已有 executed 记录会拒绝，需先审查业务数据及审计 ID，再决定恢复方案，禁止静默删除样本。

## 验证与限制

- 本地 PGlite 编译并验证计划、预览、确认、执行、重放，以及审计关联失败时计划事务回滚；生产两条迁移任务均成功。
- WP07 修复版测试 6/6，旧 V2 5/5，AI Skill 7/7；WP01 安全目录 664 项通过、匿名网关 51/51、隔离旧路由 94 通过/0 失败/5 项按原定义跳过。一次隔离浏览器超时发生时页面和 URL 均已正确渲染，复跑完整门槛通过；测试工具保留 URL/fixture 诊断，不更改业务路由。2026-10-04 再次复跑 WP01 门槛为 PASS_WITH_LIMITATIONS；单独真实 prtest 登录及 WP06 只读回归 14/14 通过。
- 部署后仅以无登录态调用 `assistant.quickCaptureV2.execute`，返回 `UNAUTHORIZED`；云端 `assistant` 的 Nodejs18.15、90 秒超时及三个必要配置键仍在。云端只读源码核对：主页面 HTTP 200 且 SHA-256 相同、22 个页面引用产物相同、28 个 CRM 函数的 163 个源码/配置文件相同。
- 客户 ID 789、790 与活动参与者 ID 19、20 是新增的未映射记录。2026-10-04 用户确认可暂缓处理；核实没有错误 Person 关联或招募/活动交叉引用。保留记录，并在 WP04 身份审计例外清单逐条列明，不按姓名合并，不删除客户数据。
- 真实账号、生产 CloudBase AI 模型、互动/事实/承诺/行动的人工确认写入及幂等重放均已验收。实际手机设备未验证，390px 浏览器模拟和 WP06 时间线已验证。WP01 通用登录证据有效期另行判断；本轮 prtest 现场验收证据独立记录，不以旧摘要冒充当前通用登录报告。

## 发布与恢复

首轮仅部署 `assistant` 函数，以及 `admin.html`、`crm/js/modules/quick-capture-v2.js`、`crm/css/quick-capture-v2.css`；审计即时关联修复仅部署 `assistant` 与 V2 JS，发布标签 `release-20261004-074319`、提交 `81bd9602da0a4fb638fb33b8970ab1b43fd87969` 已通过三端核对。本次最终验收仅更新本文档和 WP07 任务状态，不重新上传未改动的云端产物。云端页面：`https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html`。

代码恢复以 `release-20261003-215500` 为基线创建新提交，重部署本轮四个产物并核对，不强推。数据库先按上述两份 rollback 的顺序逆序评估；若已有执行记录，保留业务和审计行并另案制定数据恢复，不直接运行主 rollback。
