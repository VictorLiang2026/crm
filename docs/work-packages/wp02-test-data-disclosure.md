# WP02 测试样本标记与真实看板提示

日期：2026-10-03（Asia/Shanghai）。范围：R11、R12、R14，仅 WP02；不生成样本。发布状态见末尾发布记录。

## 授权、基线和影响

用户已专项确认：新增两张 public 空台账及 migration/rollback；完整 ID 清单仅服务端访问；旧函数读取受限摘要；Today、漏斗、AI Context/Search、活动/招募统计与提醒增加“含测试数据”；保持筛选、排序、计数、Legacy，不生成业务或 AI 样本。

已读取 AGENTS.md、环境/安全边界及 specs/target-crm-v1/{requirements,design,tasks}.md。这三份文件继续保留在每个 WP 的必读清单；其规划内容不视为执行其他 WP 的授权。

回滚代码基线：fdf1268354c4c2f634c1b95b435f0a9cd3615fa7 / release-20261003-010000。
本地/GitHub 相同；静态主页面与 18 个原有资源一致；28 个函数的 147 个原有文件与发布提交一致。基线下载证据：D:\Temp\crm-cloud-audit-f4100e44b849471799e6a2c9f74c6cc0。一次比对与新文件创建重叠，以及一次 Git archive 换行差异，分别产生“Missing online”和哈希误报；最终按已发布提交比对（仅规范 CRLF/LF）确认原源码一致，没有据此覆盖线上差异。

| 类别 | 本 WP 影响 |
| --- | --- |
| 页面 | admin.html 的 Today/旧复盘、驾驶舱、漏斗、招募漏斗、活动量、目标统计；晨间简报、AI Search、活动关系复盘、Person 关系提醒模块 |
| 接口 | today_coach、funnel_insight、activity_reports、recruit_goals、recruit_candidates、assistant、ai_activity、person_360 的受影响只读结果附加 testData；assistant.testSamples 默认拒绝，实际执行始终关闭 |
| 字段 | 旧查询补取已有主键以核对来源；不改旧字段约束；AI Gateway 在 context_snapshot._testData 记录批次摘要并向模型提示虚构来源 |
| 数据 | 无业务/AI/样本 DML；只新增空台账结构。37 张旧表逐表行数未变，台账 0+0 |
| 权限 | 新台账仅 service_role SELECT/INSERT/UPDATE；anon/authenticated 无台账权限。新摘要函数仅内部匿名通道及 service_role，authenticated 无 EXECUTE |
| Legacy | 原统计/筛选/排序/小样本隐藏转化率/登录/软删恢复/人工确认链路保留；未改 db.js、ai.js、旧 SQL 视图、路由或模型配置 |

## 标记、约束和计数

- 统一批次：crm_test_[a-z0-9][a-z0-9_]{0,47}；可见文本必须包含【系统测试·勿联系】。
- actions.source / commitments.source 有小写正则，且 ai/ai_ 前缀关联 confirmed_by_uid/confirmed_at 校验；不能用批次覆盖 AI 来源。
- activity_tasks.source 是 manual/ai/template；interactions.source_type、learnings.source_type 等为枚举或关联约束；不写批次进去。
- knowledge_items.metadata 为 JSON object，可在未来明确保留旧字段的前提下放命名空间标记；此 WP 不改现有 metadata 或任何业务行。
- public.crm_test_batches 保存批次；public.crm_test_records 保存 batch_key + record_table + record_id、初始/衍生/AI 审计类型、稳定 seed_key、父记录及可见标记。允许表名仅为核实的 37 张 public 业务表。
- initial_slot 全局唯一且仅 1..10；不是每批各 10 条。初始业务行唯一索引避免跨批重复登记；稳定 seed_key 支持同批幂等。
- seed dry-run 将主行与同步 effects 逐条展开，使用服务端 manifest 和场景，忽略客户端 plan/count/confirmed；真实身份与服务端 UID allowlist 必须同时满足。默认无 UID 授权；生产未配置场景；execute 始终拒绝。
- recruit_candidates 的同步路径可能创建 Person，且旧 create 会创建 recruit_milestones；均须在 WP03 展开并计入初始上限。
- 衍生与 ai_tasks/ai_runs/ai_results 不占初始槽位，但必须引用同批父记录。WP03 实际种子器启用前，还须接入业务衍生/AI 审计逐行登记及真实事务/幂等验证；WP02 只交付约束、追踪结构与只读门槛，不宣称已经生成完整场景。

## 提示语义

摘要只返回批次、来源表、条数，不返回完整 ID 清单或业务文本。普通计算从未增加排除测试样本的条件；提示显示“含测试数据”，来源条数不等于业务指标。
Today 标记本次计算输入，包含用于排序和提醒的来源，不声称每条 Top 5 都是样本；指纹包含摘要以提示旧缓存。
漏斗复用原 v_funnel_stats，额外核对有效实体及确实进入逾期统计的跟进来源；不改变小样本规则。
活动量按原日期规则选择来源；招募目标保持原月份口径。嵌入的目标统计单独提示其月份来源。
AI Search 只核对当前返回名单及已有证据；总数大于返回名单时明确提示未显示结果的来源未核验，不冒充全量证明。Search 的 AI 仍只解析条件，名单来自原 SQL。
AI Gateway 的模型输入、任务快照和返回结果附摘要；task/run/result 原外键继续可追踪。模型配置和人工确认门槛不变。
读取摘要失败或旧缓存没有摘要时显示“测试数据标记暂未核验”，不静默当作无测试数据。提示使用 textContent，避免把来源文本作为 HTML。
此 WP 不增加任何外发动作，不调用真实 AI 来制造验证审计行。

## 验证与失败路径

- npm run test:wp02：16 项后端/安全夹具 + 1 项隔离浏览器测试。
- 成功路径：混合夹具仍进入 Today、漏斗、活动日期桶、招募里程碑、AI Search；加标记前后旧统计事实相同；AI 输入与 task/run/result 可关联；来源批次可见；摘要去重/分块。
- 拒绝路径：未登录/匿名/不在 allowlist、伪造 confirmed/plan/count、全局超过 10（包括关联与触发器行）、非法批次/缺可见标记/外发开启、执行入口未启用、摘要读取失败；全部不写数据库。
- 浏览器专项首次存在清理方法和全局函数假设错误，停止发布后修正为正确清理及隔离响应夹具；重跑通过，未改业务计算来迎合测试。
- 相邻 Legacy 隔离回归：94 PASS，0 FAIL，5 个原有 SKIP。覆盖登录成功/失败、客户列表/详情、跟进、活动、招募、回收站、Quick Capture 及旧错误/空页面。
- AI Gateway/Context/活动复盘/原子目标保存补充单测：19 PASS。
- WP01 发布门槛纳入 WP02 必需测试；620 项目录/角色断言通过；原 97 个对象权限逐项未变，仅接纳已批准的 3 个新对象。
- 匿名网关 49/49 通过；新摘要 RPC 的浏览器匿名请求 HTTP 401 被拒绝。
- tests/wp02/permissions-readonly.sql 在 READ ONLY + ROLLBACK 中实际切换 anon/authenticated/service_role：直接台账读取拒绝、公开匿名摘要拒绝、内部摘要允许、服务角色空表读取允许。此测试不冒充真实已登录浏览器会话。
- 本次最新真实登录证据过期，记录“需人工登录”；服务密钥 HTTP 链路、真实业务写入/AI计费、移动真机未验证。没有样本，因此非空线上业务闭环留给 WP03。

## 文件与发布清单

新增：
- cloudbase/migrations/20261002173000_test_sample_registry.sql 及 .rollback.sql；第二份备份位于 C:\Users\victor\cloudbase\migrations。
- cloudfunctions/_shared/test-data.js 及 8 个受影响函数的独立副本。
- cloudfunctions/assistant/test-seed-policy.js。
- crm/js/modules/test-data-notice.js。
- tests/wp02/run.test.cjs、browser.test.cjs、permissions-readonly.sql。
- 本报告及 docs/testing/wp02-evidence.json。

修改只涉及表中列出的页面/函数、共享 AI Gateway 的两个部署副本，以及必要的测试夹具、权限基线、package scripts 和 WP01 发布门槛。无新 Cloud Function，无旧表/视图/路由删除或重命名。

迁移 20261002173000 / test_sample_registry：云任务 task-2080bce0 Succeed，远端迁移历史已核对。初次名称 wp02_test_registry 被工具正则 ^[a-z][a-z_]*$ 拒绝；更名后规划和执行成功，未绕过版本化迁移流程。

已部署 8 个函数和 6 个静态文件，未部署文档、测试或其他函数。部署后 9 项实际调用通过：漏斗事实、客户/招募活动量、招募目标、招募漏斗的成功路径，以及 assistant / ai_activity / person_360 / today_coach 未登录拒绝路径。没有真实 AI 调用；调用后台账仍为 0+0，AI task/run/result 仍各为 4。请求 ID 见 docs/testing/wp02-evidence.json。

发布标签：release-20261003-022730；提交以该标签指向为准。执行 tools/release.ps1 完成部署后全量云端比对、Git 提交、原子推送 master+标签、发布后三端比对；本发布记录和 tasks.md 的完成标记仅在整条发布流程成功后生效。线上地址：https://crm-d1gkae8ddc930d151-1434199662.tcloudbaseapp.com/crm/admin.html 。

## 回滚

先基于 release-20261003-010000 创建恢复提交，重新部署本 WP 的 8 个函数及旧 admin.html / 4 个旧模块；新提示模块可暂留，不全量上传或删除其他产物，不强推。
数据库 rollback 仅删除本 WP 的摘要函数和两张空表，不使用 CASCADE；只要任一台账有行就拒绝回滚，须另行评估 ID 追踪和数据影响。不得用回滚删除未来样本或用户数据。同步恢复权限基线后重新跑门槛并发布恢复标签。

