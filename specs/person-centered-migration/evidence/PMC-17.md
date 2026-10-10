# PMC-17 证据：全系统复审并验收 Person 为唯一基础信息来源

状态：**已验收（2026-10-10 用户确认验收）**。指令①～⑥全部落地；发布标签 `release-20261010-102500`（提交 `46c30d7`，三端核对一致）；验收记录标签见 handoff.md §2。核心结论：Person 已成为全系统人物基础信息的唯一权威来源（写入经 `PersonService.updateBasicsWithProjection` 受控边界、读取以 Person 为准、旧物理列降为兼容投影）。
开包日期：2026-10-10（用户下发 PMC-17 指令；前置 PMC-08～16 均已验收，PMC-16 验收记录发布标签 `release-20261010-062610`）

## 0. 执行纪律声明

- 已重读 `execution-contract.md`（A–N）、`AGENTS.md`、`tasks.md`、`handoff.md`。
- 本包先重新核实范围；任何新增行为变更（旧写路径收敛、桥触发器处置、约束实施、姓名唯一约束变更）逐项交用户补充确认后才实施。
- 盘点数据全部来自 2026-10-10 实时查询（tcb fn list / tcb db execute / 本地源码），不沿用 PMC-01 旧清单。

## 1. 指令①：实时全量盘点（2026-10-10）

### 1.1 云函数（线上 54 = 28 CRM 无前缀 + 26 pr_* 体验版禁碰）

本地 `cloudfunctions/` 28 目录与线上 28 个无前缀 CRM 函数**一一对应，无新增函数**。`pr_*` 26 个仅记录存在，不访问不修改。

逐函数 action 清单（实时源码提取；✱=单入口事件函数无 action 分发）：

| 函数 | action 数 | actions |
| --- | --- | --- |
| activities | 15 | addParticipant, applyTopics, create, get, getActivityData, getSummary, linkParticipant, list, listByPerson, remove, removeParticipant, searchPerson, update, updateParticipant, updateStatus |
| activity_reports | 2 | customer, recruit |
| activity_speakers | 6 | create, get, list, remove, search, update |
| activity_tasks | 7 | complete, create, get, list, remove, skip, update |
| activity_topics | 6 | create, get, list, remove, search, update |
| ai_activity | 8 | decompose, learning, participantReview, postReview, postReviewV2, prepare, recommendSpeakers, recommendTopics |
| ai_followup | 2 | analyze_profile, analyze_recruit_profile |
| ai_parse | 1 | quick_capture |
| ai_recommend ✱ | 1 | {customer_id, operator?} 事件入口 |
| ai_recommendations | 6 | create, get, list, listAll, update, update_status |
| ai_referral ✱ | 1 | {customer_id, operator?} 事件入口 |
| assistant | 9 | command, conversationPlaybook, conversationPlaybookHistory, meetingPrep, opportunityCandidate, quickCaptureV2, search, summarize, testSamples |
| customers | 7 | create, get, list, remove, restore, trashList, update |
| followups | 4 | create, list, remove, update |
| funnel_insight | 2 | explain, stats |
| gifts | 4 | create, list, remove, update |
| ocr_records | 4 | create, list, remove, update |
| opportunities | 5 | close, create, list, remove, update |
| person_360 | 52 | addCanonicalParticipant, addMember, closeOpportunity, commitQuickCaptureV2, createInteraction, createOpportunity, createSpeakerProfile, executeActivityReview, executeIdentity, executeOpportunity, executeWorkItem, get, getContextGroups, getCustomerProfile, getInsuranceContext, getMeetingPrepContext, getOpportunityLinks, getPersonOnlyRecruit, getRelationshipDecay, getTimelinePage, linkSpeakerPerson, listActivityData, listActivityOutcomes, listDueCommitments, listInteractions, listOpportunities, listOpportunityDirectory, listPendingOpportunityCandidates, listPeople, listPersonOnlyRecruitTrash, listPersonOnlyRecruits, listPersonWorkItems, listRecruitContext, listTodayWorkItems, listUnlinkedOpportunityActions, lookupCustomer, previewActivityReview, previewIdentity, previewOpportunity, previewWorkItem, recordActivityInteraction, remove, removeMember, removeOpportunity, removePersonOnlyRecruit, resolveIdentity, resolveQuickCaptureName, restorePersonOnlyRecruit, saveFacts, search, updateOpportunity, updatePerson |
| photos | 5 | create, get, list, remove, update |
| policy_review_reports | 5 | generate, get, list, remove, update |
| products | 3 | list, remove, upsert |
| recruit_candidates | 9 | create, funnel, get, list, rcMap, remove, restore, trashList, update |
| recruit_followups | 4 | create, list, remove, update |
| recruit_goals | 5 | getProgress, listBenchmarks, listGoals, saveBenchmarks, saveGoals |
| recruit_recommend ✱ | 1 | {candidate_id, operator?} 事件入口 |
| recruit_score ✱ | 1 | {candidate_id} 事件入口 |
| today_coach | 4 | candidates, cockpit, daily_review, generate |

与 PMC-01 清单对比：函数集合 28/28 一致（零新增）；person_360 的 action 自 PMC-01 后扩展至 52（PMC-08~16 各包批准新增：resolveIdentity/previewIdentity/executeIdentity/updatePerson/getPersonOnlyRecruit 等），均有对应 evidence。

### 1.2 数据库对象（public schema，实时）

- **表 47**、**视图 12**、**DB 函数 35**（全部 x1 无重载）、**触发器 51**。
- 触发器分类：guard/校验类 7（actions_guard、commitments_guard、learnings_guard、context_items_validate、activity_participants_canonical_guard、activity_speakers_person_guard、crm_test_identity_command_guard）；PMC-15 角色派生同步 5（crm_person_role_{customers,participants,persons,recruits,speakers}_sync）；**旧桥/同步 2**（customer_person_identity_bridge ON customers、recruit_candidate_person_sync ON recruit_candidates）；zz_crm_test_track 测试跟踪 37（覆盖 37 张表，测试基建）。
- **后台任务**：cloudbaserc.json 28 函数均无定时触发器；无云端计划任务。维护脚本（tools/ 53 个）全部为手动执行工具（迁移/诊断/发布/同步），无常驻任务。

### 1.3 共享模块副本

`_shared/` 11 模块、全函数 73 副本：db.js/ai.js 各 28 副本全一致（sync-shared 发布门 PASS）；person-service.js（assistant/person_360）、interaction-service.js+legacy-interaction-adapter.js（person_360）、context-engine.js（ai_activity）、ai-gateway.js（ai_activity/assistant）、test-data.js（8 函数）与母本一致；**skill-registry.js 两副本与母本有向差异**（assistant +16 行注册 quick_capture_v2 技能、ai_activity −33 行裁剪）——sync-shared.cjs 设计上只追踪 db.js/ai.js（PMC-03 R11 已登记），差异为函数定制，非未同步事故；本包登记观察。

### 1.4 前端写入口（Person 基础字段）

- **Console（新 AI-native）**：`console/write.js`——新建走 resolveIdentity→previewIdentity→executeIdentity（服务端同名解析+人工确认+命令链）；编辑走 updatePerson（9 字段白名单+乐观锁+软删守卫）。**均经受控边界**。
- **Legacy admin.html**：`customers create/update`（行 2017/2020 等）——直写 customers 基表基础字段，经 `customer_person_identity_bridge` 触发器推 persons（customers→persons 方向）；招募经 recruit_candidates create/update → `recruit_candidate_person_sync` 触发器确保 Person。**不经过 Person 受控边界**（无白名单/乐观锁/预览确认链），为当前唯一仍活跃的 legacy 基础资料写入口。

### 1.5 读取路径（Person 基础字段）

- persons 直读：13 个函数 19 处 + _shared 模块（PMC-11 起 AI 上下文/展示名 Person 优先）。
- 视图：recruit 系 4 视图 Person 优先+customers 回退（PMC-12）；v_action_center 走 persons；customers_view / followups_view / gifts_view / photos_view / products_view / ai_recommendations_view / v_funnel_stats 仍读 customers 基表（旧投影，只读兼容）。
- customers.get 详情：person_id 存在时基础 7 字段 Person 优先+customers 回退（PMC-09）。

## 3. 指令②③实施：Legacy customers 写路径改道 Person 受控边界（2026-10-10，用户裁决"改道受控边界（推荐）"）

### 3.1 方案

- `_shared/person-service.js` 新增 `updateBasicsWithProjection(personId, fields, {expectedUpdatedAt?, projection?})`：白名单 7 字段（display_name/phone/wechat/gender/birthday/occupation/education）→ persons UPDATE（软删守卫+可选乐观锁）→ 可选投影回写 customers（仅作兼容投影，非权威）；投影失败抛 PROJECTION_FAILED 由调用方重试（persons 值已为权威）。
- `customers/index.js`：`PERSON_BASIC_FIELDS` 映射（customer_name→display_name、wx_account→wechat 等）。
  - **create**：resolveName 服务端解析；多同名→PERSON_AMBIGUOUS（不自动选择）；唯一同名已关联→PERSON_ALREADY_LINKED；唯一未关联→复用并仅写非空基础字段；无同名→建新 Person；customers 建行含投影值；双向关联回写（customers.person_id + persons.legacy_customer_id）。
  - **update**：基础字段经边界写 persons+投影；业务字段直写 customers；无 person_id 且 legacy 无 Person→**PERSON_NOT_LINKED 拒绝**（不静默旧值兜底）；OCR 快照 ≥3 字段漂移拦截保留，forceRestore 经边界写入。
- **桥触发器不动**：`customer_person_identity_bridge_trigger`（AFTER UPDATE OF 7 字段 + IS DISTINCT 守卫）仍保留——投影回写值与 persons 一致时不触发（同值无 IS DISTINCT）；仅在其他未接管入口直接改 customers 时兜底。移除须单独批准（指令③）。无循环：persons 表无反向触发器。
- 共享副本同步：person-service.js 母本→assistant/person_360/customers 三副本 SHA 一致；56 副本 sync-shared PASS。

### 3.2 验证

- 隔离测试 `tests/pmc/pmc17-write-boundary.test.cjs` **9/9**（A1-A4 update 改道/拒绝/forceRestore/纯业务字段；B1-B3 create 三态；C1-C2 静态契约）。
- PMC-16 回归复跑 **7/7**（fixture 适配新边界：客户含关联 Person；A2 断言更新为边界双写语义）。
- 全套 pmc **87/90**（3=G-PMC14-1 既有，改道前已证实 3 失败同源）；全量 node --test **205/209**（4=pmc11 fixture 既有，stash 验证改道前即 3 失败、第 4 项同 fixture）。
- 回归 `tests/regression/run.cjs` **107/0/5**（backend.cjs 依赖白名单增 './person-service'；account.logout 首次失败复跑 PASS=浏览器时序抖动，与改道无关）。
- WP01 门 **blockers=[]**（开放项 login/service-runtime/live-writes/mobile 为既定未验证项）。
- 部署：customers/assistant/person_360 三函数代码更新成功（WP01 门+56 副本校验通过后上传）。
- **生产只读复核（部署后）**：drift_rows=1（customer 788/person 783 occupation，PMC-04 登记已知）、customers_active_no_person=3（A1-A3 已知）、persons_no_legacy_customer=2、customers 782/persons 781、person_id_mismatch_legacy=0——与部署前**零漂移**。

## 4. 范围核实结论与待确认事项（更新）

1. ~~Legacy customers 写路径收敛~~ → **已实施（本节 §3）**；桥触发器/recruit 同步触发器**保留未移除**（移除须单独批准）。
2. ~~约束实施~~（指令④）→ **已实施（本节 §5）**：migration B 已应用并核对全绿（SET NOT NULL + recruit 部分唯一索引 + 两 DB 函数适配；UNIQUE/FK 查明为 PMC-05 既有）；D5 姓名唯一约束/D8 customer_id 列退出**本包不实施**（用户未选）。
3. ~~回归与性能~~（指令⑤，阈值 ±20%）→ **已执行（§6）**：post-migration WP01 门 blockers=[]、全量 206/209（3 既有）、隔离 9/9、生产漂移全绿；四读入口建立 PMC-17 性能基线。
4. ~~影响矩阵收口~~（指令⑥）→ **已执行（§7.5）**：U1/U2/U4 关闭、U3 调查关闭（行动挂起 D8）、U5/U6 维持挂起、U7/U8 维持登记；验收报告 §7。

## 5. 指令④实施：约束与两 DB 函数适配（migration B，2026-10-10 已应用）

### 5.1 范围核实中的一项更正

批准范围为"customers.person_id 三重约束"。实施前实时核查发现：**UNIQUE（`customers_person_id_key`）与 FK（`customers_person_id_fkey` → persons(id) ON DELETE RESTRICT）自 PMC-05 migration `20261008120000` 起已在效**（D1 设计原文即"回填完成后置 NOT NULL"）。故 migration B 实际 DDL 收敛为：`SET NOT NULL` + recruit 活跃行部分唯一索引；UNIQUE/FK 不重复创建、不改动。

### 5.2 前置核对（2026-10-10 实时，全部通过）

- customers：person_id NULL=0、含软删重复组=0、孤儿=0；活跃 782/软删 1；persons legacy_customer_id 重复=0、孤儿=0。
- recruit_candidates：person_id NULL=0、**活跃重复=0**、含软删重复 1 组（软删行允许重复，故采用 `WHERE deleted_at IS NULL` 部分唯一索引）、孤儿=0；活跃 15/软删 3。
- 列类型：customers.person_id 与 persons.id 均 bigint（FK 类型兼容）；`recruit_candidates_person_id_active_key` 索引名无冲突。
- 部署顺序按批准执行：先部署 customers 函数代码（含 create 直写 person_id），**已验证线上代码与本地逐字节一致**（index.js / person-service.js / db.js SHA-256 相同，经 `tcb fn code download` 比对），再应用 migration。

### 5.3 migration B（`20261010093000_pmc17_customers_person_id_constraints.sql` + 同名 rollback）

单 DO 块原子执行（经 `cloudbase_postgres` 角色；service_role 跑 DDL 报 42501 permission denied for schema public——与 PMC-15 DDL 通道一致）：

1. 守卫断言 4 条（customers NULL/重复/孤儿、recruit 活跃重复）——任一失败 RAISE 整体回滚；实际全 0 通过。
2. `person_identity_execute_v1` CREATE OR REPLACE：唯一改动=客户分支 INSERT customers 列清单加 `person_id`、VALUES 加 `v_person.id`（消除先 NULL 后 UPDATE 窗口）；REVOKE/GRANT 重演。
3. `crm_test_scenario_v1` CREATE OR REPLACE：种子调序——先 INSERT persons（不带 legacy_customer_id）→ 两行 manual 角色原位（此时无派生竞争，origin 保持 manual；其后 customers INSERT 带 person_id 触发的派生 ON CONFLICT DO NOTHING 不覆盖）→ INSERT customers 带 person_id → UPDATE persons 回写 legacy_customer_id；REVOKE/GRANT 重演。
4. `ALTER TABLE public.customers ALTER COLUMN person_id SET NOT NULL`。
5. `CREATE UNIQUE INDEX recruit_candidates_person_id_active_key ON public.recruit_candidates(person_id) WHERE deleted_at IS NULL`。

应用结果：成功（ExecutionTimeMs=23）。回滚文件守卫式复原：两函数原始定义逐字复原 + DROP NOT NULL + DROP INDEX（不动 PMC-05 既有 UNIQUE/FK）。

### 5.4 应用后核对（全绿）

- `pid_nullable=NO`；UNIQUE=1、FK=1 在效；recruit 部分唯一索引=1。
- `person_identity_execute_v1` 定义含 `occupation,education,source,person_id`（新 INSERT 形态）；`crm_test_scenario_v1` 定义含 `INSERT INTO public.customers(customer_name,person_id`（调序后形态）。
- 授权：两函数 service_role EXECUTE=2、anon/authenticated=0；proacl 仅 `{service_role=X/owner, owner=X/owner}`，无 PUBLIC 授予。
- 数据零漂移：customers NULL=0/重复=0/孤儿=0（782/1）；recruit 活跃重复=0/孤儿=0（15/3）。
- WP01 门：PASS_WITH_LIMITATIONS，blockers=[]（catalog 790 项 checks 全绿；wp04 身份审计 customers 782/782 全映射、participants 3 项既有声明例外；回归 107/0/5；匿名 59/59）。开放项维持 login/service-runtime/live-writes/mobile 既定未验证。

### 5.5 新登记观察项（非本包引入，不阻塞；修复须另行批准）

- **G-PMC17-1（候选）**：`crm_test_scenario_v1` 触发器守卫（20261003005000 行 156-164）白名单仅含 `zz_crm_test_track`+2 守卫；实时核查确认其后创建的 `customer_person_identity_bridge_trigger`（20261004011800 起）与 PMC-15 三个派生触发器（customers/persons/activity_participants）不在白名单——dryRun/confirm/execute 三阶段当前必然 RAISE 'Unreviewed seed trigger'（status 阶段正常）。属测试基建白名单滞后，自桥触发器创建起即存在，**非本包引入**；本包保持守卫文本逐字不变。白名单扩充（对 4 个已批准触发器按名+md5 登记）须单独批准。

## 6. 指令⑤：跨模块回归、权限、真实入口与性能（2026-10-10，migration B 应用后）

### 6.1 回归汇总（全部 post-migration 重跑）

| 层 | 结果 | 说明 |
| --- | --- | --- |
| WP01 发布门 | **PASS_WITH_LIMITATIONS，blockers=[]** | catalog 790 项 checks 全绿（47 表/12 视图/36 序列/35 函数；migration B 新索引与两函数重定义未触发漂移）；匿名 59/59；wp04 身份审计 PASS_WITH_EXCEPTIONS（customers 782/782 全映射、participants 3 项既有声明例外）；回归 107/0/5 |
| 全量 node --test | **206/209** | 3 失败全部为 tests/pmc/pmc11-identity.test.cjs fixture 既有问题（candidate not found，改道前已证实同源）；较本包改道前基线 205/209 少 1 项失败，无新增失败 |
| PMC-17 隔离 | **9/9**（复跑） | A1-A4 update 改道/PERSON_NOT_LINKED 拒绝/forceRestore/纯业务字段直写；B1-B3 create 同名三态；C1-C2 静态契约 |
| PMC-16 隔离 | 7/7（含于全量） | OCR 冲突 diff+人工确认 forceRestore 恢复闭环 |

场景覆盖对照（指令⑤点名项）：**同名**→B1-B3+wp04 同名 fixtures（服务端 resolveName+人工确认，AI/客户端不自选）；**多角色**→PMC-15 派生触发器链+pmc 角色 fixtures；**并发**→execute_v1 advisory lock(name_key)+候选指纹重检+preview 过期/变更拒绝 fixtures；**重试**→execute 幂等（status='executed' 直接返回原结果）+PROJECTION_FAILED 调用方重试语义（A 组）；**旧客户端**→Legacy admin.html 全量回归 107 项（含 quickcapture.preserve、recycle.customers/recruit、restore 路径）；**恢复**→PMC-16 OCR forceRestore 7/7。

### 6.2 权限检查

- catalog 790 项 checks 零失败：RLS/视图 security_invoker/授权基线无漂移；migration B 后两函数 proacl 仅 `{service_role=X/owner, owner=X/owner}`，anon/authenticated/PUBLIC 均无 EXECUTE。
- 匿名网关 59/59：新索引与约束无对外授权面。

### 6.3 真实入口验证（生产只读，2026-10-10）

- 漂移 6 指标：**drift_rows=0**（§3.2 时 1，customer 788/person 783 occupation，migration A 回填后归零）、**customers_active_no_person=0**（§3.2 时 3，A1-A3 经 migration A 全部关联）、persons_no_legacy_customer=2（既有）、customers 活跃 782/persons 活跃 784、person_id_mismatch_legacy=0。
- customers 函数线上代码与本地逐字节一致（index.js/person-service.js/db.js SHA-256，经 tcb fn code download 比对）。
- INSERT INTO customers 全量生产入口实时复核（pg_proc prosrc + 28 函数源码）：仅 3 条（execute_v1 客户分支、crm_test_scenario_v1 种子、customers create），三条均已直写 person_id，与 NOT NULL 约束闭环。

### 6.4 性能（阈值 ±20%；诚实声明：无历史同口径基线，本次建立 PMC-17 基线）

生产网关实测（tcb-exec ExecutionTimeMs，每入口 5 次）：

| 入口 | min | median | max |
| --- | --- | --- | --- |
| 列表：`crm_customers_page_v1(1,20,'','Id','desc')` | 12 | **17** | 32 |
| 搜索：`crm_search_people_v1('activity_no_followup',3,30)` | 14 | **22** | 25 |
| 统计：`v_funnel_stats` | 32 | **37** | 42 |
| 招募列表：`v_recruit_candidates` | 5 | **13** | 16 |

- 同会话迁移前后对照探针：unique-precheck 16ms→10ms、recruit-precheck 11ms→15ms（均为毫秒级管理查询，偏差在网关噪声内）。
- 分析性说明（推理非测量）：migration B 为约束类 DDL（NOT NULL+18 行表部分索引）与两条写路径函数重定义，不触碰读路径函数/视图/查询计划；§3 改道影响 customers create/update 写路径，读入口（列表/搜索/统计）自 PMC-09/12 起形态未变。
- 限制：无 iPad 真机性能复测（桌面只读探针代替）；login/service-runtime/live-writes/mobile 维持既定未验证开放项。

## 7. 指令⑥：影响矩阵收口与「Person 唯一基础信息来源」验收报告（2026-10-10）

### 7.1 验收结论

**结论：Person（`public.persons`）已成为全系统人物基础信息的唯一权威来源。** 此时旧物理列（customers 同名 7 列等）仍存在，但均为明确的兼容投影/历史快照，不再承担独立基础资料写入。任何关键入口未验证、未接管或身份未确认时不得宣布完成——本报告逐项给出证据与遗留边界。

### 7.2 基础字段权威矩阵（指令②逐字段证明）

| 字段（persons） | 权威值 | 有效写入路径 | 有效读取 | 旧字段性质 |
| --- | --- | --- | --- | --- |
| display_name / phone / wechat / gender / birthday / occupation / education | persons 行（782/782 customers 全映射，orphan=0） | ①Console：resolveIdentity→previewIdentity→executeIdentity（服务端同名解析+人工确认+命令链）；②Console 编辑：updatePerson（9 字段白名单+乐观锁+软删守卫）；③Legacy customers create/update：本包改道后经 `PersonService.updateBasicsWithProjection` 受控边界（白名单 7 字段+软删守卫+可选乐观锁），投影回写 customers；未关联 Person 的 update 拒绝（PERSON_NOT_LINKED，不静默旧值兜底） | customers.get/列表 RPC Person 优先（PMC-09）；recruit 系 4 视图 Person 优先（PMC-12）；AI 上下文 8 字段 Person 优先（PMC-11）；v_action_center 走 persons | customers 同名列=兼容投影（值与 persons 一致时桥触发器不触发）；followups/gifts 等姓名列=历史快照（PMC-16 确认不改写） |

### 7.3 写入口接管总账（指令②③）

| 写入口 | 状态 | 证据 |
| --- | --- | --- |
| Console 新建/编辑 | 经受控边界（既有） | §1.4；wp03/wp07 fixtures |
| Legacy customers create/update（admin.html） | **已改道受控边界**（本包） | §3；隔离 9/9；生产零漂移 |
| person_identity_execute_v1 客户分支（DB） | INSERT 直写 person_id（migration B） | §5.3/§5.4 |
| crm_test_scenario_v1 种子（DB，测试基建） | 调序后直写 person_id | §5.3/§5.4 |
| 其余 25 个 CRM 函数 + 全部 DB 函数 | 实时复核无 customers 基础字段写入 | §1；§6.3 三入口闭环复核 |
| customers.person_id 结构约束 | NOT NULL+UNIQUE+FK 全部在效（UNIQUE/FK 为 PMC-05 既有，NOT NULL 本包） | §5.4 |

### 7.4 旧触发器/双写桥收敛（指令③，逐项）

| 对象 | 消费者接管证据 | 处置 |
| --- | --- | --- |
| `customer_person_identity_bridge_trigger`（customers→persons） | 全部已知写入口已接管（§7.3）；投影回写同值时 IS DISTINCT 守卫不触发；仅在未接管入口直改 customers 时兜底 | **保留未移除**（移除须单独批准；当前作为防御性兜底，无双写竞争——persons 无反向触发器） |
| `recruit_candidate_person_sync`（recruit→persons 确保） | recruit create/update 走 customer 匹配链（R-ID1），Person-only 招募走 identity command | **保留未移除**（同上） |
| PMC-15 派生触发器 ×5 | 角色派生实时重算，origin 语义经 migration B 调序验证保持 manual/derived 区分 | 在效，不动 |

切换瞬间写入防遗漏：本包无同步方向改变（桥方向未反转），改道为同事务双写（persons 权威+customers 投影），无增量核对窗口。

### 7.5 影响矩阵未知项收口（指令⑥逐项）

| # | 结论（2026-10-10 实时） | 状态 |
| --- | --- | --- |
| U1 | 3 个无 Person customers 已经 migration A 关联（wp04：customers 782/782 映射、例外 0；customers_active_no_person=0） | **关闭** |
| U2 | `activity_participants.person_id` FK **已在效**（1 条，孤儿 0）——未知前提过时 | **关闭** |
| U3 | `activity_speakers.customer_id` 无 FK（孤儿 0）：历史遗留便利链接；嘉宾已 Person 锚定（PMC-13）；补 FK 属 D8 同期结构动作 | **调查关闭**；补 FK 行动挂起待 D8 独立批准 |
| U4 | `persons.legacy_customer_id` 无 FK、可空（YES）：设计现状；权威方向已反转为 customers.person_id（FK+UNIQUE+NOT NULL），legacy 列降为兼容回写 | **关闭** |
| U5/U6 | opportunities/recruit_candidates 双 FK 的 customer_id 退出=D8 范围，用户已裁决本包不实施 | 维持挂起（D8 独立包单独批准） |
| U7 | ai_recommendations 无 deleted_at | 维持登记（PMC-16 裁决不修） |
| U8 | ai_tasks/ai_runs/ai_results 无 deleted_at | 维持登记（审计表设计如此，service_role only） |

### 7.6 回归、权限、性能与真实入口结论

见 §6：WP01 门 blockers=[]；全量 206/209（3=既有 fixture）；隔离 9/9；生产 6 漂移指标全绿；四读入口中位 13–37ms（建立基线）。

### 7.7 未关闭项与边界（诚实声明）

1. 桥触发器/recruit 同步触发器**保留**（移除须单独批准）——不影响"唯一权威来源"结论：其写入方向为投影兜底，非独立权威。
2. D5 姓名唯一约束解除、D8 customer_id 列/复合 FK 退出：本包不实施（用户未选/须独立批准）。同名不同人场景当前依赖准确 ID 链路（wp04 fixtures 证明），姓名唯一约束未构成阻塞。
3. G-PMC17-1（候选）：scenario 触发器白名单滞后（既有，非本包引入）；G-PMC11-1/G-PMC12-1/G-PMC14-1 维持登记；pmc11 fixture 3 项既有失败。
4. WP01 开放项：login/service-runtime/live-writes/mobile 既定未验证；无 iPad 真机性能复测。
5. relationships pending 候选写入路径属后续工作包。

### 7.8 可审计证据索引

- 盘点：§1（28 函数×action、47 表/12 视图/35 函数/51 触发器、11 模块 73 副本、双前端、无云端定时任务）
- 写路径改道：§3（方案/验证/部署/零漂移）；约束与函数适配：§5（migration B+rollback+核对）
- 回归/权限/性能：§6；影响矩阵收口：§7.5
- 探针留档：`D:\Temp\pmc17-*.sql`（实时查询）+ `tests/security/.results/wp01-catalog.json`/`wp04-audit.json`（gitignored 证据）
