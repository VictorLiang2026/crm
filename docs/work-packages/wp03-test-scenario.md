# WP03 一键幂等测试场景：业务验收通过

更新于 2026-10-03。固定场景、幂等重放、正常衍生业务、AI Search 审计及 Today 实页均已有真实证据。本次补齐最后阻点：Today 可选 AI 迟迟不返回时及时沿用已有规则建议。仅发布 today_coach 云函数代码，其余业务产物保持既有版本。Git 发布标签为 release-20261003-123000；以下完成标记仅随发布脚本提交、原子推送及三端核对全部成功生效，实际提交和核对目录以该标签及发布终端结果为准。未开始 WP04。

## 本次确认、影响与实现

已复读 AGENTS.md、环境/安全边界及 requirements.md、design.md、tasks.md，三个规格文件均可读。本地/GitHub 基线为 37f4c22ee6f91a52f7bab9f17b7e17b55de73582 / release-20261003-095500；改动前完整云核对为 20 静态资源、28 函数 158 文件、56 共享副本一致，证据 C:\Users\victor\AppData\Local\Temp\crm-cloud-audit-f61db0a2a0834945bd8732a956ef1c17。

此前已向用户说明并请求确认具体 Today 修复范围：仅 generate 增加独立等待时限、沿用规则回退、保留筛选/排序/配额与提示，覆盖成功/拒绝/超时/晚返回后仅部署该函数。用户在该具体说明后指示“继续验收，哪项没完成加强完成”，本轮据此继续该项已明确的最小修复，不重复要求一般确认。

| 影响面 | 本次实际改动 |
| --- | --- |
| 页面 / 接口 | Today 原 generate 返回恢复可用；返回结构与页面实现不变 |
| 计算 | AI 等待最多 40 秒，且不超过本次函数开始后 50 秒；超时沿用现有规则结果、5 项配额、事实清单与测试提示 |
| 字段 / 数据 | 无数据库结构、字段、迁移或数据写入；不增加种子；不更新既有业务记录 |
| 权限 / 配置 | 身份校验、RLS、模型配置、Nodejs18.15、60 秒函数上限和环境变量保持既有设置；不扩大权限 |
| Legacy | 不更改 daily_review、morning、其他函数、缓存策略、登录、软删除或人工确认流程 |

新 ai-wait.js 为本函数专用，不改共享 SDK 包装或其他 27 函数。Promise 等待保护能及时返回，但不宣称取消底层模型请求；无重试、无晚返回后的业务写入。真实模型始终慢的根因未取得阶段日志，本修复保证本次 Today 回退路径能返回，并未宣称模型延迟本身已解决。

## 验收结果

| 检查 | 结果 |
| --- | --- |
| public 结构 / RLS / 视图 / 角色 | 新鲜目录快照 646 项通过；40 表、10 视图、36 序列、19 routine；无权限漂移 |
| 匿名矩阵 / 守卫 | 50 项匿名拒绝、12 项守卫通过 |
| WP03 / WP02 | 18 / 17 项通过；WP03 新增 6 项覆盖真实 Today handler 的成功、拒绝、超时、剩余预算、晚返回与空分支 |
| 相邻旧功能 | 94 PASS、0 FAIL、5 SKIP；包括登录、客户、跟进、活动、增员、回收站与错误/空态 |
| 真实只读与页面 | 部署后 66 PASS：真实会话/角色、50 个 public HEAD 拒绝、非法种子拒绝、计数不变、Today 普通来源、场景/Person/旧客户/旧活动/漏斗与 390px 视口 |
| 旧客户普通读取 | 有效真实会话下虚构唯一关键词返回 rows=[]、total=0；与上述 50 HEAD 和真实会话组成新鲜 52 项登录证据 |
| public 数据关联 | 12:08 的 10 项只读检查全部通过：初始全局上限、slot、实际行、父记录、标记、空联系方式、普通行动视图、零新增确认凭据、AI 提示与 task/run/result 链 |
| Today 真实实页 | 12:09:10 生成成功，耗时 43058ms；规则排序 5 条，普通 all_actions 纳入虚构样本，显示“含测试数据”，来源批次 verified；没有 FUNCTIONS_TIME_LIMIT_EXCEEDED；12:13:12 再经原重新生成按钮复验，41423ms 通过，明确命中等待超时回退 |
| 场景 / AI 主链 | 沿用已完成的真实生成、零新增重放、正常行动确认、真实 AI Search 及逐条审计证据，详见历史记录 |

Today 实页由用户本人登录的真实 CRM 页面通过普通 callFn 调用已部署云函数，未伪造响应。该窗口使用本地静态文件；生产静态文件一致性由独立 sync-check 核对。首次验收工具用完整相等比较识别超时原因，漏掉旧函数的中文前缀；读取同一 generated_at 结果确认含 TODAY_AI_TIMEOUT 后修正工具为包含匹配，原报告保留。页面通过判定与该分类字段无关，不篡改失败为成功。

此前 wp01-report 的真实 Today FAIL 完整备份为 wp01-before-today-repair.json；首次实页失败仍保存在 wp03-ui-today.json。修复前测试、范围授权、修复后实页各自记录，未将 candidates 或离线测试当作真实生成。最新实页和只读工具均逐次保存时间戳副本；不导出密码、令牌、真实客户文本或完整测试 ID 清单。

## 数据、发布与新增文件

12:08 及两次 Today 后 12:16 数据快照均为 initial 10 / derived 2 / ai_audit 3；预览凭据 5，其中 4 次已执行的零新增重放。本轮修复、失败参数探针和 Today 验证无业务/AI 审计新增。11:38 预览凭据为 5：首次生成、首次重放，及测试账号随后三次 initialNew=0 重放；凭据不计入初始业务种子。计数按观察时间限定，不把用户并发操作当作探针写入。

12:06:22 已通过标准单函数部署脚本上传 today_coach，随后状态 Active；仅 index.js 与新 ai-wait.js 是本次云端代码差异，无静态上传。56 共享副本一致。发布脚本需逐一核对 20 静态资源和 28 函数 159 源码/配置文件，再提交、打标签、原子推送并重新核对；源码相同不能替代上表业务证据。

本次新增：

- cloudfunctions/today_coach/ai-wait.js。
- tests/wp03/today-timeout.test.cjs、readonly-live.cjs、today-live.cjs、verify-readonly.sql、README.md。

修改：today_coach/index.js、tests/wp03/run.test.cjs、本报告及 tasks.md。所有新增验收工具仅进 Git，不上传静态托管。本次没有 migration/rollback，因为没有数据库变更；原 WP03 两组 migration/rollback 仍在下方历史清单中。

## 未验证项与回滚

手机真机、另一真实非 allowlist 账号、旧晨间简报/经营复盘的真实模型调用未验证；390px 只是桌面模拟，非 allowlist 拒绝有离线覆盖。旧功能的所有真实新增/编辑/删除/恢复没有全部在生产执行，不拿真实客户做破坏性测试。上述项不冒充 WP03 通过证据。

本次 Today 修复可从 release-20261003-095500 恢复 today_coach 的原代码，并只重新部署该函数，创建新的恢复提交/标签，不强推；这会恢复已知的旧超时风险，回退后需重新验收。测试工具可随代码恢复，无数据回滚需要。整个 WP03 若回退到 WP02，使用 release-20261003-022730，仅恢复 assistant 和四个静态产物；已存在的测试业务/审计必须单独制定数据保留方案。数据库 rollback 会拒绝非空台账，不得清空数据来绕过。

---

## 历史执行记录（以下状态按当时时间理解，最新结论以上文为准）

### 首轮与续验记录

更新于 2026-10-03 11:36。已加强只读验收：数据库关联 10 项、真实权限/拒绝路径及页面 66 项通过；WP03 12 项、WP02 17 项、旧功能 94 项通过。用户重新登录后真实页面和 390px 模拟通过，Today 实页两次 60 秒超时尚未修复；最小修复等待专项确认。WP03 未验收，没有开始 WP04。测试/报告仅本地更新，未继续提交/打标签。

## 授权与基线

已读取根目录 AGENTS.md、环境与安全边界，以及 specs/target-crm-v1 的 requirements.md、design.md、tasks.md；三个规格文件均可读。用户已专项确认固定 10 行、受控入口、public 预览与台账触发器、衍生业务和 AI 审计关联、迁移/回滚、真实账号验证及受影响产物发布。2026-10-03 用户再次授权所需权限和继续执行。

基线提交 dbf979063b277aece96060ce77f20b01a2c44db4，标签 release-20261003-022730。开发前本地/GitHub 一致；19 静态资源、28 函数 156 文件、56 共享副本一致，原证据 D:\Temp\crm-cloud-audit-4397320f3e2b4d1c947688373ec2f818。本轮恢复时再次确认 GitHub 基线，并从云端下载 assistant 原版，17 文件逐一匹配基线后才部署。

## 影响与实现

| 范围 | 实际变化 |
| --- | --- |
| 页面 | 更多 → 测试场景；逐表预览、确认身份、生成/打开；人物/客户/Today/漏斗/AI 搜索/预填行动入口 |
| 接口 | assistant.testSamples 验证真实身份及单账号 allowlist；服务端 PersonService.resolveName；过期预览、身份与状态绑定；AI Search 将实际命中的样本关联到既有审计链 |
| 字段 | 旧表没有增改列，旧视图没有重建；关联样本的可见文本加标记；样本人物/客户禁止联系方式；拒绝混合真实身份 |
| 数据 | 固定全局最多 10 条初始业务行；重复复用，不隐蔽补建；后续正常确认流程产生的业务与 AI 记录分开记账 |
| 权限 | crm_test_previews 仅 service_role SELECT/INSERT/UPDATE，FORCE RLS；新函数仅服务端执行；完整 ID 清单仅服务端；入口限定现有 prtest 账号 |
| Legacy | 保留登录、callFn、软删除/恢复、原查询、排序、计数、已有路由；未改模型、运行时、外发通道 |

固定批次 crm_test_main_v1，标记【系统测试·勿联系】，人物名【系统测试·勿联系】虚构体验甲。初始组成：Person 1、客户 1、角色 2、跟进/互动/机会/行动/活动/到场各 1，共 10。触发器额外业务行 0；执行前再次核对触发器定义和预览指纹。数据库变更仅 public，没有访问 pr 或 pr_* 对象。

前端只获得打开人物/客户/活动所必需的目标 ID 和数量；完整清单在 crm_test_records。真实后续行动仍需查找并选人、规划、服务端预览、确认、执行。AI 仍使用已有 Gateway/云端配置。

## 数据库与权限补充

- 20261003005000_test_scenario 已应用，任务 task-118fb106 Succeed；新增 crm_test_previews、crm_test_refs_v1、crm_test_track_v1、crm_test_scenario_v1、crm_test_link_ai_v1，以及 37 个 zz_crm_test_track 触发器。
- 20261003011000_test_trigger_service_grant 已应用，任务 task-2714db1a Succeed；仅为新触发器函数补 service_role EXECUTE，与既有私有触发器权限约定一致，anon/authenticated 保持拒绝。没有削弱测试规则。
- 两组 migration/rollback 均已双备份至 C:\Users\victor\cloudbase\migrations。
- 当前实际目录 40 表、10 视图、36 序列、19 routine；旧 100 个对象权限保持基线。
- assistant 新增单个 CRM_TEST_SEED_UIDS 配置，绑定用户指定的现有 prtest；原两个环境变量逐值核对保留，值不进入报告。Nodejs18.15、90 秒超时等配置未变。

## 验证与已遇到的问题

| 验证 | 结果 |
| --- | --- |
| public 结构、RLS、视图与角色权限 | 646 项通过 |
| 匿名网关矩阵 | 50/50 通过 |
| 新私有 RPC 匿名拒绝 | scenario / refs / link_ai 三个接口均 HTTP 401，没有写入 |
| 门槛/共享/安全等守卫测试 | 12 项通过 |
| WP02 专项回归 | 17/17 通过 |
| WP03 专项 | 10/10 通过，含隔离浏览器和公共 assistant 入口拒绝 count=11、自选批次/人物 ID |
| 相邻旧功能回归 | 94 PASS、0 FAIL、5 SKIP；登录、客户/详情、跟进、活动、增员、回收站及错误/空态均有夹具路径 |
| SQL 事务夹具 | 已在真实 public 以 service_role BEGIN/ROLLBACK 运行通过，无持久化业务行 |
| 线上未登录 testSamples.status | UNAUTHORIZED，请求 18e24c59-1a73-43bc-b64e-faeeea2a9ed8 |
| 静态资源一致性 | 20 个页面/模块/样式与本地一致 |
| 云函数一致性 | 正式 sync-check 核对 28 函数、158 源码/配置文件一致；证据 D:\Temp\crm-cloud-audit-0de6be89eb474882add91b9c348987c2 |
| 真实账号与权限 | prtest 真实 getSession、50 个 public 表/视图 HEAD 拒绝、旧客户虚构关键词空查询，共 52 项通过；密码和令牌未落盘 |
| 真实场景生成与幂等 | 已由真实登录窗口完成固定 10 行生成；再次 UI 预览为 0 新增，确认/执行后仍 10 行；2 份已确认并执行的预览记录 |
| 正常衍生流程 | 预填人物/标题，经原人物选择→规划→预览→确认→执行，生成行动及 assistant_action_commands 各 1；两行均有台账父记录 |
| 普通看板与搜索 | Today cockpit 返回虚构人物及 containsTestData=true；漏斗 stats 同样标记，真实漏斗页面显示“含测试数据”；普通 crm_search_people_v1 查询命中样本 |
| 真实 AI Search | 通过现有示例及普通 UI 调用；结果含虚构人物与“含测试数据”；task completed、run success=true、result 关联完整，3 条 AI 审计均记账 |
| Today 实页 | FAIL：旧版今日建议 today_coach.generate 超过 60 秒，FUNCTIONS_TIME_LIMIT_EXCEEDED，未显示预期提示；不能以 cockpit 接口通过替代 |
| 移动真机 / 晨间简报按钮 | 未验证；晨间简报按钮未执行，不将今日建议超时误记为晨间简报失败 |

事务夹具覆盖 dry-run 不写业务、未确认与错身份拒绝、生成 10 行、同预览重放、第二次预览新增 0、普通 Search/行动视图/漏斗纳入样本、第 11 初始槽拒绝、衍生行动记账、task/run/result 三条审计记账、联系方式拒绝。事务结束后批次、台账、预览和样本 Person 均为 0；37 张业务表前后计数一致，自增序列可能有正常间隔。

此前门槛失败原因是新触发器没有 service_role EXECUTE，已通过单独 migration/rollback 解决并重跑，未篡改原迁移。受限网络使匿名检查最初“未验证”，在本机已授权网络复跑 50/50 通过。云 CLI 登录过期，重新授权成功；授权后的原下载命令退出，随后正式只读一致性检查重新执行。不存在被掩盖的业务回归失败。

代码复核按 CloudBase code-review 的 AUTH001/SEC001/PG-CR001/PG-CR002 核对身份来源、凭据不回传、表结构先核验及服务端 RLS；存储上传规则不适用此 WP。

## 部署与 Git

仅部署 assistant 代码及 admin.html、test-scenario.js、phase14-hubs.js、assistant-action-create.js 四个静态文件；未全量部署函数或项目。assistant 更新请求 3faaaa9e-2ad7-4120-8956-33a15de70cc9，状态 Active；19 个源码文件逐一与线上相同，原环境变量保留。共享 56 份副本一致。数据库迁移按上述任务单独应用。

代码已发布：提交 40113c9e9e4e2867a18be9a77ba5178a9fa98eed，标签 release-20261003-093000。发布后正式三端核对通过，证据 D:\Temp\crm-cloud-audit-4e094014ee744d40962679f820f3c94a：本地/GitHub master/标签一致，20 个静态资源、28 函数 158 文件一致。随后仅更新本报告和 tasks 的真实测试证据，不再部署业务产物；文档发布标签 release-20261003-095500。WP03 仍未整体验收，剩余 AI 项如下。

## 真实测试步骤与当前阻点

1. 运行 node tests/wp03/live.cjs，在单独 Edge 窗口以 prtest 登录；不向聊天发送密码。该工具只提供本地真实页面，不自动登录或确认。
2. 更多 → 测试场景：点击预览，核对人物、逐表 10 行和触发器 0 行；确认后生成。
3. 再预览/确认/生成，初始数量必须仍为 10；打开人物、Today、漏斗，普通结果纳入样本并显示“含测试数据”。
4. “预填下一步行动”按正常流程人工选人、规划、预览、确认、执行；确认衍生行 ID 在台账。
5. AI 搜索点击现有示例“最近三个月参加过活动但没有继续跟进的人”，核对普通结果含样本、提示及 task/run/result 关联。没有真实外发。

09:43 后用户在测试窗口完成登录和首次生成。按已批准范围与用户的自动确认指示，继续通过普通 UI 验证零新增重放，以及固定虚构人物的预填行动。09:52 核对：初始 10、衍生 2、AI 审计 0；2 份预览均已确认/执行，其中第二份 initialNew=0。虚构 Person 联系方式为空，10 个初始 slot 全部唯一且位于 1–10。

37 张业务表与执行前基线逐表比较：actions +2（初始 1、衍生 1）；persons/customers/followups/activities/interactions/opportunities/activity_participants 各 +1；person_roles +2；assistant_action_commands +1；其余 27 表计数不变，共增加 12 行。每条 ID 由受保护的 public.crm_test_records 保存；报告不复制完整 ID 清单。没有真实联系方式、真实保单或外发通知。

已在真实样本存在后重跑完整发布门槛，权限 646、匿名 50、WP03 10、WP02 17、旧回归 94 全部通过；登录矩阵也通过。WP01 通用报告的 service-runtime/live-writes 固定说明不自动吸收 WP03 专项证据，实际场景写入与普通接口结果以上表为准，不代表已做所有旧业务增删改恢复或真实 AI。

AI 资源疑点已排除：最初将资源包接口空列表视为阻断，是旧技能规则导致的误判。CloudBase [当前官方模型说明](https://docs.cloudbase.net/en/ai/model/overview) 明确 Token 资源包于 2026-06-18 停售，现用资源点套餐。实时 queryEnv 核实本环境 EnvDeductionMode=credits、UsageStatus=normal、套餐有效至 2026-10-11，既有模型已启用。按用户“旧文档与实时事实冲突时以核实事实为准”的要求，保留配置完成真实 AI Search；无需购买、改模型或扩大权限。

截至 10:07，台账为 10 初始、2 衍生、3 AI 审计；task/run/result 父记录关联完整且运行成功。AI 搜索普通结果命中样本并提示来源。

最终 Today 实页报错：Invoking task timed out after 60 seconds，代码 FUNCTIONS_TIME_LIMIT_EXCEEDED，请求号 6e44926b-bece-11f1-a3ed-5254007594e6。错误属于旧版今日建议生成；晨间简报仅展示按钮未执行。未确定超时根因，也未调整超时或顺带重构。旧函数日志接口已下线，尚未取得底层阶段日志；后续须使用 CLS 在该请求范围只读定位。现场证据 tests/security/.results/wp03-ui-today.json 仅保存错误和状态。

在该实页失败出现前，文档提交 37f4c22ee6f91a52f7bab9f17b7e17b55de73582 / release-20261003-095500 已完成正式三端检查：20 静态资源、28 函数 158 文件一致，证据 D:\Temp\crm-cloud-audit-63fb53edcb2c48c9b4bef8417764b6c9。此次新失败说明未继续发布，不能宣称当前工作树干净或 WP03 全部成功。

一次自动审批拒绝了把整批含签名下载 URL 写入结果文件，原因是临时访问凭据不必要持久化。该文件未写入；后改为即时使用链接下载源码，再使用恢复登录的正式 CLI 核对。不将临时凭据提交 Git。

## 2026-10-03 续验结果

- 已复读 AGENTS、环境/安全边界及三个规格文件。本地提交与 GitHub master、已有发布标签仍一致；工作树保留本报告与 tasks 的未提交失败说明。
- 真实登录窗口由漏斗进入 Today，没有重新生成种子。实页出现虚构人物和“含测试数据”；但 today_coach.generate 再次超时，错误 FUNCTIONS_TIME_LIMIT_EXCEEDED，请求 0c9fd784-bed3-11f1-bc20-5254000956fc。提示与样本显示通过不等于今日建议通过。晨间简报按钮仍未执行。
- 第二次失败已记入本报告；独立 JSON 证据写入报 ENOSPC，D 盘剩余 0 字节，未成功保存。首次证据及 wp01-report 的 wp03-live-today FAIL / BLOCKED 保留，未覆盖失败或自行清理文件。
- 只读云端复核：20 个静态产物、56 份共享副本通过，前 17 个函数源码通过；下载 opportunities 时 CLI 返回 exit 1，未完成全量核对，不能报告本轮三端全通过。部分证据目录 D:\Temp\crm-cloud-audit-10e451506d4c41498c4c4cd8b4cff8fd。原脚本丢弃 CLI 标准输出，尚无足够证据判定下载失败根因。
- today_coach 云端仍为既有 Nodejs18.15、60 秒配置；CLS 状态未启用，精确请求日志搜索未取得阶段日志，不能认定具体数据库或模型阶段为根因。本轮未开通日志、调超时、改权限、改模型或改业务实现。
- 本轮没有新增业务/AI 样本、数据库迁移或部署；初始样本仍沿用已有场景。依照失败停止规则，不提交、不推送、不打新标签。恢复验收需先处理 Today 超时；若需修改旧功能，须先列明最小影响与回归范围并按 AGENTS 修改前第 3 条取得专项确认。

## 10:49 只读定位与待确认修复范围

用户再次要求继续验收。本地与 GitHub master 仍为 37f4c22；重新读取三个规格文件及环境/安全规则。已将本轮生成的临时下载目录 10e451506d4c41498c4c4cd8b4cff8fd 移至 C:\Users\victor\AppData\Local\Temp 下同名目录；移动前后均为 104575 个文件、620880761 字节，原目录已移走，D 盘恢复约 700 MB 可用空间。没有清理用户业务文件。结果保存于 tests/security/.results/wp03-audit-relocation.json。

真实登录的 today_coach.candidates 约 1319ms 成功，testData verified、8 条来源；public 台账重新查询仍为 initial 10 / derived 2 / ai_audit 3。一次只读 SQL 使用了错误列 record_kind，数据库拒绝；随后依据现有 migration 的 origin 列查询成功，没有数据变更。

读取已有云端下载包的 SDK 实现，并以完全替换网络层的离线夹具验证：现有写法 timeout=40000 只出现在请求 body，网络 timeout 为空；放在第二参数也被该模型适配路径忽略。此证据确认旧 40 秒设置不能保证回退及时执行，不能据此断言实际网络服务为何变慢。诊断记录 tests/security/.results/wp03-timeout-diagnosis.json 已保存；没有第三次盲目调用生成。

待专项确认的最小范围：只为 today_coach.generate 增加独立 AI 等待时限（最多 40 秒，预留函数返回时间），超时沿用旧规则建议及测试来源提示；不改筛选/排序/配额、模型配置、数据库/权限、旧 daily_review 与 morning。覆盖成功、拒绝、超时、晚返回、空候选及相邻旧功能后仅部署 today_coach。尚未写业务代码，发布门槛仍 BLOCKED。

10:53 重新采集 public 目录并独立执行权限断言：646 项通过，40 表、10 视图、36 序列、19 routine，未发现权限漂移。快照保存于 tests/security/.results/wp03-resume-catalog.json，未替换旧失败报告或延长其有效期。

完整云端源码核对恢复通过：20 个静态资源、28 个 CRM 函数的 158 个源码/配置文件、56 份共享副本一致；证据 C:\Users\victor\AppData\Local\Temp\crm-cloud-audit-f61db0a2a0834945bd8732a956ef1c17。GitHub master 与本地 HEAD 37f4c22 一致，报告与 tasks 有明确未提交修改；此结论不替代业务验收。没有部署、提交、推送或新标签；Today FAIL / 发布 BLOCKED 保持。

## 加强验收（用户再次要求）

本次仅增加测试、工具与文档，不改变页面、接口、字段、数据、权限或 Legacy 实现。保留 11:00 的业务源码云端一致性证据，没有因测试文件变化重新上传业务产物。三个规格文件保持可读。

| 检查 | 本次结果与边界 |
| --- | --- |
| public 数据关联 | verify-readonly.sql 的 10 项全部通过：全局初始 10、slot 1–10、台账对应业务行存在、衍生父记录、可见标记、身份联系方式为空、普通行动视图、已确认零新增重放凭据、AI 测试提示与 task/run/result 链 |
| 真实只读探针首轮 | 60 PASS：有效 SDK 会话/角色 2、50 个 public 表/视图 HEAD 均拒绝、现有场景 1、非法 count/batch/confirmed/person/preview 请求 5、数量不变 1、Today 普通来源 1 |
| 页面会话 | 首轮按原有五分钟规则要求重新登录，保留 MANUAL_LOGIN 历史；用户登录后复跑通过，没有绕过登录页或写活动时间戳。有效 SDK 凭据不等于 UI 会话仍有效 |
| 探针会话守卫 | 加强后的工具在任何 SDK 检查前先检查页面锁定/五分钟时限；2 个新增离线测试通过，证明锁定时零 SDK 调用、请求仅 HEAD/状态/非法参数、不会确认或生成、输出无令牌 |
| WP03 / WP02 | 12 / 17 项通过；两个隔离浏览器首次因 C 盘临时目录 EPERM 未启动，按本机权限重跑后通过。新增守卫测试首次引用缺 .cjs 后缀，修正测试引用后 11 项服务端/工具测试通过；未改业务实现 |
| 相邻旧功能 | 94 PASS、0 FAIL、5 SKIP；隔离 fixture 路径，不冒充线上 CRUD 或 AI 成功 |
| 真实页面与视口 | 重新登录后完整探针 66 PASS：前述 60 项及场景、Person 360、旧客户详情、旧活动详情、漏斗、390px 场景布局。各页检查自身 DOM 标志与加载失败状态，避免把上一页内容误判为新页成功；未点击业务修改按钮 |
| 数据前后 | initial 10、derived 2、ai_audit 3 保持不变；验收开始预览凭据 2，11:38 观察为 5。指定测试账号在 11:30、11:34、11:37 又产生三份已确认并执行的凭据，initialNew 均为 0，进一步证明重复打开不增加初始样本。只读探针本身没有调用有效的预览/确认/执行；同步发生的账号操作与探针分开记账 |

新增 tests/wp03/readonly-live.cjs、verify-readonly.sql、README.md，修改 run.test.cjs。工具逐次保留带时间戳的摘要，不保存凭据、真实客户文本或完整 ID 清单；结果与 SQL 摘要仅在被忽略的 .results 内。工具整体状态固定保留 BLOCKED，不能用只读接口取代 Today 实页失败。

收尾计数快照单独保存为 tests/security/.results/wp03-strengthened-final-counts.json，按数据库观察时间限定；用户继续操作可能增加后续确认凭据，不能把历史快照表述为永久不变。

未验证：手机真机；另一真实非 allowlist 账号（拒绝路径仅离线覆盖）；Today 修复后实页。前置会话守卫的离线测试及重新登录后的真实会话链均已通过。未覆盖旧失败报告，也未重跑整套发布门槛来抹去 FAIL；本地工具变更尚未提交/推送/打标签，因已有业务失败继续停止发布。

这些新增验收工具不涉及 migration 或数据库 rollback；撤销本轮工具改动不改变云端或样本。WP03 整体数据库回滚仍按下节限制另行评估。

## 原 WP03 新增文件

- 两组 migration/rollback，共 4 文件。
- cloudfunctions/assistant/test-scenario-service.js、person-service.js（共享母本独立副本）。
- crm/js/modules/test-scenario.js。
- tests/wp03/run.test.cjs、browser.test.cjs、database-rollback.sql、live.cjs。
- 本报告。

其他修改为前述路由/更多/预填、assistant/Search、package scripts、批准的权限基线、WP01 接入 WP03 门槛、WP02/旧回归资源和 tasks 进度。没有扩展到其他工作包。

## 回滚

代码回退依据 release-20261003-022730，只重新部署本轮受影响的 assistant 与四个静态产物，恢复时创建新提交/标签，不强推。旧版本不引用新增模块，无需删除云端文件。恢复 assistant 配置时仅移除本轮 CRM_TEST_SEED_UIDS，保留其他环境变量。

当前已有 10 初始、2 衍生和 3 AI 审计记录，数据库 rollback 会主动拒绝，不能直接运行。须先另行制定保留追踪和数据影响方案；经批准清理到台账为空后，才可按逆序评估 20261003011000 与 20261003005000 的 rollback。脚本不用 CASCADE、不删除旧业务数据，不能静默删除已产生的业务/AI 行。

