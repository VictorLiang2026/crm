# PC32 多步骤事务与幂等审计

日期：2026-10-18。PC32-A/B 已发布；父包未完成，后续链逐项验收。

## 前置与范围

PC31 已完成：提交 `25f23435048618a2a3d3b8bdebf95f449686a253`，标签 `release-20261018-004100`。真实机会查询 21/21，通过活动读取、稳定招募分页及性能测量。发布后 29 函数、198 个源码/配置、73 静态资源及 GitHub 一致，证据 `D:\Temp\crm-cloud-audit-14bbf1693dcf48d3bea2ac03beb8821e`。这是 PC32-A 的代码基线和回退点。

用户明确批准 PC32-A：仅修复 `public.crm_ai_experience_learning_v1` 的同键操作者/完整输入绑定、并发串行处理及事务内候选/审计写入；保留 PC29 接口、返回与人工确认，成对 migration/rollback，使用虚构样本回归并发布。该批准不包含其他链的行为变更。

影响入口为现有 AI 结果反馈的 Learning 候选保存，经 `assistant` 既有服务调用上述 RPC。函数签名、返回字段、`confirmLearning`、前端中英文本和 iPad 页面保持兼容；表列、视图、RLS、授权、Cloud Functions、运行时及模型配置没有变更。仅 public；无真实业务记录修改或外发。

## 逐链状态矩阵

| 链 | 线上已存在的事务/防重 | 当前结论及下一步 |
| --- | --- | --- |
| Quick Capture V2 | 测试账号专用的 assistant plan/command 有命令锁、actor、预览和回执；Console 当前走 person_360 的 `quick_capture_v2_commit` | 新建 Person 时先 `executeIdentity` 再 `commitQuickCaptureV2`，两次 RPC 可能半写入；已有 Person 的互动/事实同一 RPC，但无请求幂等键。PC32-C 拟优先修新建分支，具体范围待批准；Legacy 保留 |
| 身份新建 | 命令行锁、姓名 advisory lock；Person、角色、业务档案和命令结果同 RPC | 保留已有治理；补逐步骤失败、重试验收 |
| Opportunity 候选晋升 | 候选行锁；Opportunity、候选状态、AI 结果同事务 | PC32-B 将已执行 replay 放在请求形状和原确认操作者核验之后；虚构事务与并发验证通过 |
| 活动复盘 | 命令 actor/版本校验，业务成果、来源占用和执行结果同 RPC | 保留已有实现；补故障注入验收 |
| 招募创建/阶段 | 创建候选+里程碑原子；阶段行锁、updated_at 冲突拒绝 | 不等同有请求幂等键；重复创建/旧版本可明确拒绝。补并发/失败证据 |
| 招募目标 | 已有原子 saveGoals RPC | 保留，不重写；现有门禁夹具覆盖 |
| OCR apply/undo | 命令 actor、Person/客户/OCR 行锁与版本；字段、反向命令和结果同事务 | 保留已有实现；补撤销失败与重试验收 |
| AI 决策/Outcome | 各自 RPC 比对 actor 与完整输入，唯一键防重复 | 已用登记虚构 AI/Action 来源完成 10 项事务及故障回滚检查；首次并发写入的唯一冲突仍待独立验证 |
| Learning 候选 | 原函数同键仅比对主来源/learning/scope | PC32-A 修复目标；其他输入与 actor 未绑定，已通过虚构样本复现 |

只读线上定义保存于本地忽略的 `tests/security/.results/pc32-function-audit.json` 和 `pc32-additional-functions.json`。矩阵描述已确认代码事实，不将代码审阅等同故障注入已通过。

## PC32-A 设计及兼容

- 迁移前函数定义 MD5：`35d51ed4e311dcee8764c470e53f93ec`。迁移先检查基线；`CREATE OR REPLACE` 保持原对象及授权。
- 同 candidateKey 使用事务 advisory lock，再 `FOR UPDATE` 查候选。锁摘要仅用于串行调度；真正的重放判定按完整 JSON 值与服务端 actor 比对，不依赖摘要相等。
- 九项规范化输入全部参与比对。来源 ID 按集合排序；文本按原保存规则 trim；可选空文本与 null 一致；反例顺序/重复保持原契约。换人或改变字段返回 `22023`，同请求返回原 ID。
- 新记录在已有 provenance 增加 `requestVersion/requestPayload`。历史 PC29 记录根据已有列、actorUid 和 sources 重建输入；缺失可信审计则拒绝，不猜测、不回填身份。
- 最新人工决策和实际 Outcome 用同一查询快照收集，校验的来源就是最终保存的来源；候选及审计同一 INSERT。仍以 `confirmed=false` 创建，之后由原人工确认 RPC 处理。
- 迁移和 rollback 均只替换目标函数；rollback 核对新函数 body MD5，并保留业务记录及审计。恢复旧代码会恢复较弱的幂等校验，实际回退前须评估这一风险；不自动回滚数据。

## 验证计划与当前证据

1. PC29 基线离线服务/浏览器 7/7；新增迁移契约 3/3，与 PC29 服务组合 9/9。
2. 用现有台账的已完成虚构 AI 来源准备事务夹具；Outcome/Learning 由既有触发器自动登记 derived。反馈审计表不在台账表白名单中，通过其已登记 ai_result_id、测试 actor/reason 追溯，且随本次测试事务全部回滚。
3. 初次测试准备曾与自动台账重复插入，触发主键拒绝；已改为断言自动登记，未修改触发器或关闭约束。旧函数随后真实复现 `PC32 replay accepted a different actor`。失败事务后 Learning、该测试 actor 的反馈/Outcome 均为 0，全局初始种子仍为 10。
4. 上线后 `learning-transaction.sql` 通过全部 29 项断言：新审计/历史格式、九个字段变化、换操作者、规范化重放、人工确认、写入后故障回滚和重试。随后并发后的同键完整重跑也通过。
5. 事务回滚不撤销 PostgreSQL sequence 取号；允许 ID 间隙，不声称序列值完全不变。

## 发布产物

新迁移 `20261018010000_learning_idempotency.sql` 与同名 `cloudbase/rollbacks/` 文件，另备份至 `C:\Users\victor\cloudbase\`。迁移计划仅 1 条 pending、无冲突，远端既有最新版本 `20261017232000`。

按 CloudBase PostgreSQL 技能的历史对齐要求，补取本地缺失的 4 份已上线 SQL：`20260828120000`、`20260903150100`、`20260908110000`、`20260909000001`。这些仅恢复本地迁移历史和备份，不重新执行，不改变对应业务。

## 上线验收

迁移任务 `task-1fa777e670304ae6` 于 2026-10-18 00:57:53 成功；远端历史确认 `20261018010000` 已应用，函数正文 MD5 为 `980622b8b8cf607b2c49831e3fc187de`，原 service_role/owner 执行授权保持不变。迁移服务规范化语句分隔空白；使用官方 `fetchMigration` 对齐本地和备份。函数正文逐字相同，整份迁移仅有官方文件末尾换行与 API Query 字符串的差别。

第一次经同一管理工具发起的并发探针未观测到锁，不记为通过。改用两个独立 CLI 进程，明确通过 `pg_locks` 观测到重叠锁：持锁 12008ms，另一进程以 500ms 锁超时设置调用真实 RPC，在 513ms 内明确拒绝、无候选写入。持锁事务结束后，同键完整事务测试 59ms 通过。复跑命令：`node tests/pc32/concurrency.cjs`。

最终检查：Learning 总数 0，测试 actor 的反馈和 Outcome 均为 0，全局初始种子 10。无新增持久业务夹具；触发器派生台账随测试事务回滚。专项契约 3/3、PC29 服务/浏览器 7/7；既有双语 iPad 工作流仍通过。证据见 [PC32-A 遥测](pc32-a-evidence-20261018.json)。

限制：并发用例覆盖锁等待拒绝及释放后重试，未做压力容量测试；所有候选写入均为回滚夹具，没有对真实业务执行写入、模型调用或外发。未新增真实浏览器登录写入验收，未实际执行降低幂等约束的生产 rollback。WP01 自身的登录/服务角色写探针/手机未验证项仍独立保留，不冒记为通过。

WP01 于 2026-10-18 01:04:58 完成：`PASS_WITH_LIMITATIONS`，目录 995 项通过、业务回归 108 通过/0 失败/5 原有跳过、匿名权限 69/69；WP02–WP06 通过，既有 WP04 三条例外保持。官方拉取文件后重跑了完整门禁，没有复用旧文件指纹。

发布核对期间补跑其余事务链的离线基线，发现旧 `tests/wp071/identity.test.cjs` 两项失败：夹具仅接受 persons 读取，而既有 `PersonService.resolveName` 还需读取 customers.person_id 映射。立即中止 Git 发布收尾（尚未提交本包）。仅补齐夹具对精确查询形状的断言及 Person-only 空映射，保留原身份选择/拒绝断言；没有改身份服务或业务函数。随后重新执行相关回归及完整门禁，结果以本记录最后一次收尾为准。

夹具修正后，PC14/PC18/PC19/Quick Capture/身份/招募目标组合 35/35 全部通过。2026-10-18 01:08:44 最终完整门禁重新通过，仍为目录 995、regression 108/0/5、匿名 69/69，无阻断项。最新源码指纹和时间已同步到证据 JSON；未删除失败用例、未跳过其复跑。

发布标签 `release-20261018-011000`，由 `tools/release.ps1` 执行完整云端核对、提交、原子推送 master/标签以及发布后完整核对；提交号由该标签解析，最终完成以脚本退出码 0 为准。本包不重传未改变的页面或云函数。线上仍为 [Console](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/console.html) / [旧管理页](https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html)。

PC32-A 于 2026-10-18 01:20:18 发布完成，提交 `c55d2531fdba878b7a9633a02457449aaa26ef05`，标签 `release-20261018-011000`；发布脚本退出 0，本地、GitHub、29 函数 198 源码和 73 静态资源核对一致，发布后证据 `D:\Temp\crm-cloud-audit-e20e477c745047caaa7afd6916b5584d`。

## PC32-B 机会候选重试校验

用户已针对 PC32-B 的确切影响范围批准：只修 `public.opportunity_candidate_v1` 已创建状态的重试入口。原函数在候选行锁之后立即返回 `replayed=true`，跳过原确认操作者与多余预览摘要检查。以已登记虚构 Person 783、互动 10 构造全事务回滚夹具，迁移前实际复现 `PC32-B replay accepted different actor`；失败测试后候选、AI 结果、正式机会均为 0。

迁移 `20261018013000_opportunity_replay_actor.sql` 先核对完整函数定义 MD5 `a5ea39367c4c41281c221e7c0a40cb04`，仅将非 confirm 操作的预览摘要校验移到重试返回之前，并要求 `reviewed_by_uid IS NOT DISTINCT FROM` 服务端传入的操作者；代码实际使用 `IS DISTINCT FROM` 的拒绝条件，包括缺失原操作者。签名、旧返回字段、首次执行、预览、确认、现存候选和机会不变。回滚成对保存，按新函数正文 MD5 `8eea87664012f050cd6abbae02d9866e` 拒绝未知后续版本；不清除业务行。恢复旧函数会恢复原重试漏洞，实际生产回滚须先评估该影响。本包只修改 public 函数，无表列、视图、RLS、授权、云函数、静态资源或模型配置变化。

迁移任务 `task-9a8668ec116c41d5` 状态 Succeed，远端最新版本确认为 `20261018013000`。新函数正文 MD5、`SECURITY INVOKER`、`pg_catalog/public` 搜索路径及仅 service_role/owner 执行授权均已线上核验。官方 fetchMigration 对齐本地和外部备份，迁移 SQL 与远端 Query 仅差文件末尾换行；函数正文逐字一致。

服务角色虚构事务回归 14 项断言通过：首次创建/预览/确认/晋升，同操作者重试返回原 Opportunity，其他操作者、缺失操作者、额外摘要/草稿/生成参数拒绝；晋升后注入故障，候选状态、正式机会、AI 选择一同回滚，随后重试成功。整个夹具最后再次回滚，线上候选、AI 结果和正式机会均无残留。使用已有持久虚构候选 3/机会 10 做无写入并发验证：两个独立 CLI 进程间观测到锁重叠，竞争调用 506ms 内因 500ms 锁超时拒绝；释放后合法重试 14ms 返回原 ID 10，没有新机会。并发证据在 `tests/security/.results/pc32-b-concurrency.json`。

相邻离线回归 36/36 通过，覆盖旧机会候选服务、Person 机会列表与详情、PC27 编辑/关闭、PC29 反馈、PC31 路由和双语 iPad 页面。2026-10-18 01:37:13 完整 WP01 门禁 `PASS_WITH_LIMITATIONS`：目录 995、回归 108/0/5、匿名 69/69；真实登录仍未在本轮重新执行，原门禁未验证项保留。未执行真实客户写入、真实模型调用、生产回滚或容量压力测试。PC32-B 于 01:51:06 发布完成，提交 `e1027b7fe8a440714e0785ddeb46ffd989c03bce`，标签 `release-20261018-014000`；脚本退出 0，发布后 29 函数/198 源码、73 静态资源及 GitHub 一致，证据 `D:\Temp\crm-cloud-audit-4246e90dac384d60882647a1474c7de3`。逐项证据见 [PC32-B 遥测](pc32-b-evidence-20261018.json)。

PC32 父包仍有 Quick Capture V2、身份新建、活动复盘、招募阶段、OCR 撤销及反馈/Outcome 的逐链故障与重试验收；上表保留各链当前事实及待补证据，不以 A/B 两条链通过宣称父包完成。

## PC32 后续链只读审计校正

2026-10-18 复核 `crm/js/modules/console/write.js` 第 894 行、`cloudfunctions/person_360/index.js` 第 865/888/1113 行，确认当前 Console 新建人物会分别调用 `executeIdentity` 和 `commitQuickCaptureV2`。两次 RPC 不共享事务；若第二次失败，第一次建档不会自动撤销。`cloudfunctions/assistant/quick-capture-v2-service.js` 的 plan/command 仅开放给配置的测试账号，不能当作 Console 当前写入保证。现有 Person 分支内 `quick_capture_v2_commit` 原子写入互动与 Fact/Signal，但重试没有请求键；均保留为待治理风险。未修改任何业务流程。

其他函数只读复核：活动复盘命令与 OCR 命令均先核验 actor 再进入已执行回放，且有行锁和版本/期限检查；身份执行按 actor 选择命令并锁行；招募阶段行锁加 `updated_at` 冲突拒绝，尚无请求键；AI 反馈与 Outcome 比较已有 actor/输入，首次并发写入仍可能由唯一约束拒绝。这些是代码事实，不能代替逐步骤线上故障注入。下一子包只针对获批单链实施，未授权链继续审计和虚构回归。

本次矩阵事实校正与 PC32-B 发布记录补全只修改文档，拟用 `release-20261018-015500` 发布；无新云端产物，线上版本仍为 PC32-B 的数据库函数与此前页面/云函数。发布成功须由脚本退出码 0 和本地、GitHub、云端核对共同确认。

该文档更正于 2026-10-18 发布完成：提交 `91974c2302a4a6ef38ade44928cbfcb358c04de6`，标签 `release-20261018-015500`，脚本退出 0；发布后 29 函数/198 源码、73 静态资源及 GitHub 一致，证据 `D:\Temp\crm-cloud-audit-24561b0df4da4e3db5a676759557de79`，云端业务产物未变。

## AI 反馈与实际 Outcome 虚构事务复核

`tests/pc32/feedback-transaction.sql` 仅复用台账中的已完成虚构 AI 结果、Person 783 与 Action 6；所有更新与新增在同一个外层测试子事务回滚。服务角色实际调用 `crm_ai_experience_decide_v1` 与 `crm_ai_experience_outcome_v1`，10 项断言通过：首次写入、同键同输入返回原 ID、换 actor 与改 payload 拒绝；各自在写入后注入异常，确认事件/Outcome 没有半成品，随后重试仅创建一次。测试后 Action 6 仍为 open，测试键的反馈和 Outcome 行均为 0，初始台账种子 10 条。没有持久业务测试写入或模型调用。

此项证明顺序重试、身份与输入绑定及事务回滚；尚未观测两个首次请求同时竞争唯一约束的时序。该限制继续列入 PC32 父包，不将代码审阅当作并发实测。本次只新增可复跑脚本与审计文档，无云端产物更改；拟用 `release-20261018-021000` 发布，发布后仍核对本地、GitHub、云端一致。
