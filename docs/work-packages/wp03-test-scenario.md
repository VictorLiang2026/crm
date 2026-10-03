# WP03 一键幂等测试场景：代码发布，真实验收待完成

更新于 2026-10-03。WP03 尚未标记验收完成；没有开始 WP04。

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
| 真实账号/持久化场景/真实 AI/移动真机 | 尚未验证，不用夹具或哈希替代 |

事务夹具覆盖 dry-run 不写业务、未确认与错身份拒绝、生成 10 行、同预览重放、第二次预览新增 0、普通 Search/行动视图/漏斗纳入样本、第 11 初始槽拒绝、衍生行动记账、task/run/result 三条审计记账、联系方式拒绝。事务结束后批次、台账、预览和样本 Person 均为 0；37 张业务表前后计数一致，自增序列可能有正常间隔。

此前门槛失败原因是新触发器没有 service_role EXECUTE，已通过单独 migration/rollback 解决并重跑，未篡改原迁移。受限网络使匿名检查最初“未验证”，在本机已授权网络复跑 50/50 通过。云 CLI 登录过期，重新授权成功；授权后的原下载命令退出，随后正式只读一致性检查重新执行。不存在被掩盖的业务回归失败。

代码复核按 CloudBase code-review 的 AUTH001/SEC001/PG-CR001/PG-CR002 核对身份来源、凭据不回传、表结构先核验及服务端 RLS；存储上传规则不适用此 WP。

## 部署与 Git

仅部署 assistant 代码及 admin.html、test-scenario.js、phase14-hubs.js、assistant-action-create.js 四个静态文件；未全量部署函数或项目。assistant 更新请求 3faaaa9e-2ad7-4120-8956-33a15de70cc9，状态 Active；19 个源码文件逐一与线上相同，原环境变量保留。共享 56 份副本一致。数据库迁移按上述任务单独应用。

本轮代码发布标签预定 release-20261003-093000，Git 发布与最终三端检查结果以执行输出为准。该标签表示代码交付，不表示下面的真实验收已经完成。

## 真实测试步骤与当前阻点

1. 运行 node tests/wp03/live.cjs，在单独 Edge 窗口以 prtest 登录；不向聊天发送密码。该工具只提供本地真实页面，不自动登录或确认。
2. 更多 → 测试场景：点击预览，核对人物、逐表 10 行和触发器 0 行；确认后生成。
3. 再预览/确认/生成，初始数量必须仍为 10；打开人物、Today、漏斗，普通结果纳入样本并显示“含测试数据”。
4. “预填下一步行动”按正常流程人工选人、规划、预览、确认、执行；确认衍生行 ID 在台账。
5. AI 搜索点击现有示例“最近三个月参加过活动但没有继续跟进的人”，核对普通结果含样本、提示及 task/run/result 关联。没有真实外发。

当前窗口已打开，仍待用户输入测试账号密码。09:21 左右只读核对批次、台账、预览均 0；没有实际生成样本，不宣称真实幂等验证完成。

AI 预检查 DescribeEnvPostpayPackage 返回空列表（请求 5e5d6564-b43f-4185-b3a7-9e09fa3eabc7）；DescribeAIModels 显示已有配置启用。依本地 ai-model-nodejs 技能的两步预检查要求，当前不运行真实模型调用，也不擅自购买资源包或换模型。需在控制台核实/开通有效 Token Credits 后再复核。其他夹具与权限验证不受影响。

一次自动审批拒绝了把整批含签名下载 URL 写入结果文件，原因是临时访问凭据不必要持久化。该文件未写入；后改为即时使用链接下载源码，再使用恢复登录的正式 CLI 核对。不将临时凭据提交 Git。

## 新增文件

- 两组 migration/rollback，共 4 文件。
- cloudfunctions/assistant/test-scenario-service.js、person-service.js（共享母本独立副本）。
- crm/js/modules/test-scenario.js。
- tests/wp03/run.test.cjs、browser.test.cjs、database-rollback.sql、live.cjs。
- 本报告。

其他修改为前述路由/更多/预填、assistant/Search、package scripts、批准的权限基线、WP01 接入 WP03 门槛、WP02/旧回归资源和 tasks 进度。没有扩展到其他工作包。

## 回滚

代码回退依据 release-20261003-022730，只重新部署本轮受影响的 assistant 与四个静态产物，恢复时创建新提交/标签，不强推。旧版本不引用新增模块，无需删除云端文件。恢复 assistant 配置时仅移除本轮 CRM_TEST_SEED_UIDS，保留其他环境变量。

数据库先评估台账，再按逆序执行 20261003011000 与 20261003005000 的 rollback；后者仅台账为空时移除本 WP 新对象和触发器，不用 CASCADE、不删除旧业务数据。有样本时脚本主动拒绝，须另行制定保留追踪和数据影响方案；不能静默删除已产生的业务/AI 行。

