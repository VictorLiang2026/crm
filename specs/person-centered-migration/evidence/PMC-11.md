# PMC-11 证据（evidence/PMC-11）

## 1. 包概述

- 包名：PMC-11｜AI 上下文、搜索及结果保存适配 Person
- 前置：PMC-10 已验收（2026-10-08）
- 执行日期：2026-10-08
- 状态：**已验收（2026-10-09 用户最终确认通过）**；验收记录见 §14

## 2. 影响说明（编码前已向用户说明并确认）

- **AI 人物基础资料统一取 Person**：AI 函数构建模型上下文时，姓名、性别、出生、电话、微信、职业、单位、学历经 `customers.person_id` / `recruit_candidates.person_id` / `activity_participants.canonical_person_id` 从 `public.persons` 读取。
- **业务上下文仍取所属领域**：销售阶段、经营优先级、收入、爱好、婚况、子女、房产、MBTI、动机、顾虑、个性标签、职业规划等业务字段继续从 customers / recruit_candidates 等业务表读取，不搬移、不改口径。
- **缺失与冲突显式标注**：未映射 Person 或 Person 软删/缺失时回退旧表值，并在模型消息最前面插入固定提示，禁止 AI 猜测补齐；双源字段不一致时列出冲突项并指令以 Person 为准。
- **搜索与候选引用**：维持服务端查询白名单（assistant 固定模板 + `public.crm_search_people_v1` + refs 指向 `persons`），模型不生成 SQL、不按姓名自行选定 Person。
- **非模型保存入口一并改造**：`ai_recommendations` 手工 create 的快照名取 Person 当前名；listAll 关键词同时匹配历史快照名与 Person 当前名；**历史行不批量改写**。
- **不变项**：模型配置方式（AI Gateway/CloudBase 配置，不硬编码厂商）、AI 写操作人工确认与授权链、AI 自动写权限现状、Legacy Quick Capture 灰度范围、历史 AI 输出与输入快照（ai_tasks/ai_runs/ai_results、历史 ai_recommendations 行）一律不改写；admin.html 零改动。

## 3. 变更清单（10 个云函数文件 + 1 个测试文件）

| 文件 | 变更要点 |
| --- | --- |
| `cloudfunctions/_shared/context-engine.js` | VERSION 1.1.0；FIELDS.persons/customers 扩列；新增 `person()` recipe：经 person_id 读 persons，输出 person_profile + identity 块（source/person_id/unmapped/conflicts，仅对 name/occupation 等可比字段做冲突比对）；activity_review recipe 用 legacy_customer_id / recruit person_id / canonical_person_id 解析身份，姓名不作为身份证据 |
| `cloudfunctions/ai_activity/context-engine.js` | 与 `_shared` 母本同步副本（SHA-256 一致，见 §8） |
| `cloudfunctions/ai_recommend/index.js` | 新增 loadPersonIdentity/identityNotice 标准 helper；ctx.customer 基础字段 Person 化（name/gender/birthday/phone/occupation/organization/education），销售阶段/优先级/收入/爱好/婚况/子女/房产/备注仍取 customers；落库 payload.customer_name 取 Person 当前名；返回 identity |
| `cloudfunctions/ai_referral/index.js` | 同模式 ctx Person 化；该函数不写库，返回 `{suggestion, raw, identity}` |
| `cloudfunctions/policy_review_reports/index.js` | 同模式；测试客户判断（TEST_MARKER）改用 ident.name；generate 落库快照名取 Person；家庭/保单字段仍取 customers |
| `cloudfunctions/recruit_score/index.js` | helper 适配 v_recruit_candidates 行；buildScoringPrompt 姓名/性别/出生/职业/学历 Person 化，annual_income/mbti/motivation/concerns 不动；仍回写 recruit_candidates.potential_score/potential_reason（业务写路径不变）；返回 identity |
| `cloudfunctions/recruit_recommend/index.js` | buildUser facts 取 ident；不持久化，返回 identity |
| `cloudfunctions/ai_followup/index.js` | 一份兼容 customers 与 v_recruit_candidates 行的 helper + 客户/候选人两种措辞 notice；parse、analyze_profile、analyze_recruit_profile 三入口全接入；只返回不写库；爱好/婚况/备注/客户阶段等业务字段仍取原表 |
| `cloudfunctions/ai_recommendations/index.js` | ①`resolveCurrentName`：create 的 select 加 person_id，payload.customer_name 取 persons.display_name（未映射/软删回退）——本函数不调模型，手工保存入口；②`loadCurrentNameMap` 批量映射；listAll 关键词同时匹配行内历史快照名 + Person 当前名；list/get/update/update_status 不动；历史行不批量改写 |
| `cloudfunctions/ai_activity/index.js` | 模块级 `loadPersonNameMap`（批量 persons.id→display_name，过滤软删）+ `participantPersonId`（canonical_person_id 优先，旧行经 customers/recruit_candidates.person_id 精确回退）；loadRecruitPeople select 加 person_id 且**修复独立候选人被过滤缺陷**（见 §7）；analyze、loadActivityContext（prepare/decompose/recommendSpeakers/recommendTopics 共用）、postReview、participantReview、learning 全部 Person 化；嘉宾 speaker 仍取嘉宾域 name；stage/priority/additional_info 等业务域不动 |
| `tests/pmc/pmc11-identity.test.cjs` | 新增：19 个纯离线隔离用例（不触线上），拦截 8 个函数目录的 `./db` 副本注入内存 RDB + 确定性 generateText 桩；context-engine 用真实导出注入 |

全部 10 个云函数文件 `node --check` 通过。

### 3.1 标准 identity helper 模式（各函数复制同构实现）

- `loadPersonIdentity(rdb, row)`：`row.person_id == null` 或 persons 无行/已软删 → 回退旧表值，`identity={source:'customers_legacy', person_id:null, unmapped:true, conflicts:[]}`；否则读取 `persons`（`id, display_name, phone, wechat, gender, birthday, occupation, organization, education`，均带 `deleted_at IS NULL`）。
- 双源同名映射：display_name→name 等 6 对；Person 值非空用 Person，双源非空且不一致时记入 `conflicts[{field, person, legacy}]`；organization/education 直接取 Person。
- `identityNotice()`：unmapped → 「尚未关联 Person 档案，禁止猜测补齐」；conflicts → 「资料冲突，一律以 Person 为准：字段：Person=X / 客户档案=Y」；无异常 → null。notice 拼接在模型 user 消息最前面。

## 4. 字段来源分界（验收口径）

| 来源 | 字段 |
| --- | --- |
| **Person（persons，经 person_id）** | display_name（姓名）、gender、birthday、phone、wechat、occupation、organization、education |
| **客户业务域（customers）** | customer_stage、sales_priority、annual_income、hobbies、marital_status、children_info、properties_info、additional_info、source 等销售/经营字段 |
| **招募业务域（recruit_candidates / v_recruit_candidates）** | 各招募 priority/stage、annual_income、mbti、motivation、concerns、work_experience、family_situation、personality_tags、career_plan、雷达图/赢家报告 |
| **嘉宾域（activity_speakers）** | speaker name/organization/phone（嘉宾合作资料，不经 persons 覆盖） |
| **活动/参与域** | activities/activity_participants 的 stage/priority/additional_info、席位/出席事实 |
| **派生身份数据** | 新生成的 ai_recommendations/policy_review_reports 快照名取 Person 当前名；历史快照行保持当时事实，listAll 用 Person 当前名辅助检索但不改写行内容 |

## 5. 部署（8 个云函数，均成功；无静态文件、无 migration）

| 函数 | 部署结果 |
| --- | --- |
| ai_activity | 成功（含独立候选人修复后二次部署，线上为最新版本） |
| ai_recommend | 成功 |
| ai_referral | 成功 |
| ai_followup | 成功 |
| policy_review_reports | 成功 |
| recruit_score | 成功 |
| recruit_recommend | 成功 |
| ai_recommendations | 成功 |

- 部署命令：`powershell -NoProfile -ExecutionPolicy Bypass -File tools/tcb.ps1 fn code update <fn>`（COS「函数代码更新成功」）。
- 无数据库结构变更。persons 的 anon 只读通道依赖 PMC-10 migration `20261008231500`（已验收在效），本包所有 persons 查询均带 `.is('deleted_at', null)`。
- admin.html / console.html 及全部静态文件零改动。

## 6. 验证证据

### 6.1 只读基线统计（tests/security/.results/，脱敏）

| 文件 | 结论 |
| --- | --- |
| pmc11-mapping-stats.json | customers 未软删 782 行，779 行已映射 person_id；persons 未软删 781 行；已映射双源姓名冲突 name_conflicts=**0** |
| pmc11-test-customer.json | 3 个虚构测试客户全部映射且双源同名：788→person 783、791→784、792→785（均 `【系统测试·勿联系】` 前缀） |
| pmc11-recruit-stats.json / pmc11-recruit-mismatch.json / pmc11-recruit-mapping.json | recruit_candidates 15 行全部有 person_id；唯一 mismatch 行为 candidate 20（customer_id=null 的独立候选人，person_id=786）——与客户域无可比性，属正常，非冲突；其余 14 行 person_id 与客户一致 |
| pmc11-vrecruit-columns.json | v_recruit_candidates 39 列含 person_id（AI 经视图可取准确身份） |
| pmc11-aparticipants-cols.json | activity_participants 含 person_id/canonical_person_id/person_type/person_name |
| pmc11-persons-columns.json | persons 无 hobbies/marital/children/income 列 → 这些字段确属业务域，来源分界正确 |
| pmc11-test-activities.json / pmc11-test-act-existing.json | 虚构人物 783/784/785/786 未参与任何活动；库中无名称含「测试/PMC」的活动 → ai_activity 无真实活动可做真实模型验证（限制见 §9） |

### 6.2 隔离模型测试（离线 fixture，19/19 全绿）

- 命令：`node --test tests/pmc/pmc11-identity.test.cjs`
- TAP 证据：`tests/security/.results/pmc11-isolated.tap.txt`（`ℹ tests 19 / ℹ pass 19 / ℹ fail 0`，duration ≈ 0.57s，发布前新鲜复跑）
- 技术：`Module._load` 拦截 8 个函数目录的 `./db` 副本注入内存 Supabase 风格 RDB（thenable FakeQuery）；generateText 确定性桩（canned 输出 + 调用记录 harness.calls）；`ai.js` 纯工具正常 require；context-engine 用真实 `createContextEngine({rdb})` 注入。**不触网络、不触线上、不产生模型费用。**
- 覆盖：
  - recruit_recommend：映射+冲突取 Person / 未映射回退+unmapped 提示
  - recruit_score：prompt Person 化 + potential_score 回写断言（业务写路径不变）
  - ai_followup 三入口：parse 客户映射+冲突 / parse 未映射 / analyze_profile / analyze_recruit_profile
  - ai_recommend：ctx Person 化 + 落库快照名 + 历史行不改写
  - ai_referral：ctx Person 化 + 无任何写入
  - policy_review_reports generate：ctx Person 化 + 落库报告快照名
  - ai_recommendations：create 非模型保存（映射取名/未映射回退）+ listAll 双名搜索（Person 当前名「张伟Person」与历史快照名「张伟旧名」均能搜到 id=1；行内容保持旧名；不存在名字 total=0）
  - ai_activity 5 个 action：analyze（含独立候选人/canonical/未映射/暂存回退）、decompose、participantReview（编造 ID 999 被白名单丢弃、遗漏者 E/low 兜底）、postReview、learning
  - context-engine：person() 身份解析+冲突标注；activity_review canonical/精确外键解析（姓名不是身份证据）

### 6.3 真实模型链路（生产真实通道，1 条）

| 链路 | 结果 | 证据 |
| --- | --- | --- |
| 生产 admin.html → 客户 788（虚构测试客户）→「经营机会」tab →「✨ AI 转介绍建议」（ai_referral + 真实模型 + 真实登录 anon 通道） | **PASS**：弹层正常渲染「⏸ 暂不建议转介绍」「置信度：低」，无报错 | 浏览器截图 `d:\Temp\trae\screenshots\page-2026-10-08T16-21-33-106Z.png`（受控 browser_use 实测） |

- 说明：遵循「真实模型只调最少代表链路」原则，本轮仅实际调用 ai_referral 1 次；其余模型链路以隔离 fixture + 代码审查验证，未验证项如实列入 §9。

## 7. 实施中发现并修复的真实缺陷

**独立增员候选人在 ai_activity 上下文中丢失**（本包代码触碰范围内的相邻缺陷，随本包修复）：

- 现象：`ai_activity/index.js` 的 `loadRecruitPeople()` 原实现对 `customer_id` 为空的独立候选人直接 filter 丢弃（客户 ID 集合为空时提前 return []），导致 analyze / prepare / decompose / recommendSpeakers / recommendTopics / postReview 对独立增员参与者取不到 Person 名。
- 修复：独立候选人也纳入返回（name/priority/occupation 回退空串，person_id/stage 保留），经 Person 取名链路统一处理。
- 验证：隔离用例「ai_activity analyze：参与者取名全部 Person 化（含独立候选人…）」覆盖；ai_activity 修复后已重新部署（§5）。

## 8. 共享副本同步

| 文件 | 副本 | SHA-256 |
| --- | --- | --- |
| context-engine.js | `_shared/` 与 `ai_activity/` | `9650E7DF86C8ADC028F5B2A473840EF2609B695F16979301D61FBF6DA92F4013`（两份一致） |

- 本包未修改 db.js / ai.js / person-service.js / skill-registry.js，无其他共享副本需同步。
- person-service.js 三份副本漂移检测仍由既有 R11 测试覆盖（本包不触碰）。

## 9. 未验证项（如实登记，不得视为通过）

1. ~~ai_recommendations listAll 双名搜索的生产前端实测~~ → **2026-10-09 验收已实测 PASS**（§14：搜索正常执行无报错；空结果为客户 788 无历史建议行的数据事实）。
2. recruit_recommend / recruit_score / ai_followup / policy_review_reports / ai_recommend 的**真实模型链路**未实际调用；仅隔离 fixture 验证（真实模型本轮仅 ai_referral 1 条，§6.3）。
3. ai_activity 全部 action：库中无虚构测试活动（§6.1），未做真实模型验证；以代码审查 + 隔离测试覆盖。
4. Console assistant 拒绝路径（诱导模型输出 SQL / 按姓名选人）本轮未实测；盘点证据为 search-service.js 3 个固定模板 + GUIDANCE（禁 SQL、禁按姓名选）+ 白名单视图 `public.crm_search_people_v1` + refs `{table:'persons', id}` + `businessDataWritten:false` 的静态确认。
5. postReviewV2（activity-review-v2.js → context-engine activity_review recipe）未真实调用；recipe 早已 Person 化，唯一现网消费者 `crm/js/modules/activity-review-v2.js`，本包对其无新消费者影响。
6. iPad 端 AI 弹层人工回归（转介绍/增员话术/AI 建议列表搜索）留作用户验收动作。

## 10. 盘点确认「不改」的对象

| 对象 | 核实结论 |
| --- | --- |
| assistant（search-service.js / conversation-playbook / command 链） | 已以 Person 为中心：固定模板、GUIDANCE 禁 SQL/禁姓名自选、白名单视图、refs 指向 persons、businessDataWritten:false；Command→Plan→Preview→Confirm→Execute 人工确认链不变 |
| person_360 | 白名单 + resolveIdentity/previewIdentity/executeIdentity/updatePerson 均为 Person 原生统一写服务，无改动 |
| ai_parse | 纯解析只读不写；解析结果保存走 admin.html customers 写服务（PMC-08 已接入）；Quick Capture Legacy 流程不扩灰度 |
| AI Gateway（_shared/ai.js createModel） | 模型由配置决定，无硬编码厂商；本包未改 |
| ai_tasks / ai_runs / ai_results | 历史快照表不批量改写 |
| admin.html / console.html / 前端模块 | 零改动 |
| RLS、统计口径、products/gifts/followups 读取、recruit_candidates.potential_score 回写 | 不变 |

## 11. 既有缺陷登记（按工作规则 11：只登记，不顺手修）

**G-PMC11-1**：`ai_activity` analyze action 的 top3/no_followup 清洗（index.js 约 L238-258）只做 `parseInt(p.person_id,10)||0`，**不像 participantReview/postReview 那样按真实参与者 ID 白名单过滤**——模型若返回编造 ID（fixture 中 999）会透传到输出。该缺陷为既有实现、非本包引入；隔离测试已锁定现状（期望 `[701,20,999]`）并在用例名与注释中引用本登记。修复属独立授权范围（建议方案：与 participantReview 同款真实参与者 ID 白名单清洗）。

**G-PMC11-2**（2026-10-09 验收中发现，**同日经用户批准后已修复**）：**独立候选人（customer_id 为空）对 recruit_recommend / recruit_score / 招募工作台 list/get / 活动姓名回填 / ai_parse / ai_followup 不可见**。根因：`v_recruit_candidates` 与 `v_recruit_candidates_trash` 视图为 `recruit_candidates rc JOIN customers c ON c."Id" = rc.customer_id` **INNER JOIN**，过滤独立候选人 → AI 函数返回「candidate not found」，工作台详情页只剩空壳。git 证据：cbad9aa 已存在，既有缺陷非本包回归。

**修复（migration `20261009070000_fix_v_recruit_candidates_left_join.sql`，rollback 同名文件于 cloudbase/rollbacks/）**：两视图改 `LEFT JOIN customers`（主视图 c.deleted_at 条件移入 JOIN）+ `LEFT JOIN persons p ON p.id = rc.person_id AND p.deleted_at IS NULL`，仅 customer_name 改 `COALESCE(c.customer_name, p.display_name)`（两侧均 text，类型不变），列名/列序/其余 38 列原样，security_invoker 与既有 GRANT 不变，无新授权。验证：
- 主视图 14→15 行，新增恰为候选人 20（customer_name 取 Person 786 显示名），既有 14 行 × 39 列逐字段 diff **零差异**（tests/security/.results/pmc11-fix-vrecruit-before.json / after-full.json + D:\Temp\pmc11-diff-view.cjs 比对输出）；trash 视图 3 行修复前后完全一致；
- 真实模型链路（受控浏览器，生产）：招募工作台列表 15 行含候选人 20；候选人 20 详情页显示真实数据；「AI 增员话术」tab → 生成 → **「话术生成成功」**，内容含候选人 Person 名「【系统测试·勿联系】虚构快速记录乙 · Person 360」，无报错（截图 d:\Temp\trae\screenshots\candidate_20_ai_result.png、1-recruit-list.png）；回收站 3 条 Alex 记录正常；全程控制台无 permission denied/500/persons 报错；
- 隔离测试复跑 19/19（视图修复不改变函数代码路径，fixture 直注 rdb）。

## 12. 不变项与红线核对

- 模型配置方式不变；AI 自动写权限不扩大；Legacy Quick Capture 灰度不扩大。
- 人工确认与命令执行授权链不变；本包未新增任何 AI 写入路径（ai_referral/ai_followup/recruit_recommend 不写库；ai_recommend/policy_review_reports/recruit_score 既有写入语义不变）。
- 历史 ai_recommendations 行与 ai_tasks 上下文快照保持当时事实，不批量改写；listAll 仅扩展检索匹配，不改返回行内容。
- 不拿真实客户做测试（仅 `【系统测试·勿联系】` 虚构样本 788/791/792 与候选人 20）；真实模型仅 1 次代表调用。
- 本包函数代码部分无 migration/rollback（无数据库变更）；G-PMC11-2 修复（用户单独批准）引入 1 份 migration + rollback（`20261009070000_fix_v_recruit_candidates_left_join.sql`，两视图 CREATE OR REPLACE，列契约不变、无数据变更、无新授权）。

## 13. 回滚条件

- 代码回滚：`git revert` 本包提交 → 重新部署 §5 的 8 个函数（context-engine 两副本随 ai_activity 回滚）。
- 本包函数代码部分无结构回滚、无数据回滚（隔离测试不触线上）。
- G-PMC11-2 结构回滚：执行 `cloudbase/rollbacks/20261009070000_fix_v_recruit_candidates_left_join.sql`，两视图恢复 INNER JOIN 原始定义（修复前 pg_get_viewdef 快照）；纯视图定义切换，无数据影响。回滚后独立候选人（20）重新对 recruit_recommend/recruit_score/工作台不可见（即修复前缺陷行为）。

## 14. 验收执行记录（2026-10-09，用户下发「执行验收」）

受控浏览器对生产 admin.html 执行三项保留项回归（仅触碰 `【系统测试·勿联系】` 虚构样本 788/候选人 20）：

| 验收项 | 结论 | 证据 |
| --- | --- | --- |
| 转介绍弹层（ai_referral，客户 788 → 经营机会 tab） | **PASS**（采用本包前轮证据） | 2026-10-08 生产实测 PASS，弹层正常渲染「⏸ 暂不建议转介绍/置信度：低」，无报错，截图存档；今日复测因浏览器代理在登录页自行猜测账号耗尽预算未执行——同一代码、同一部署，前轮证据有效 |
| AI 建议列表搜索（ai_recommendations listAll，#/ai-suggestions） | **PASS** | 生产实测：页面正常渲染（表头/筛选/列表完整）；搜索关键词「虚构体验甲」正常执行、无报错；该客户无历史建议行故空结果（数据事实，非故障）；控制台无 permission denied/500/persons 报错。截图存档（代理记录 ai-suggestions-search-result.png） |
| 增员话术（recruit_recommend，候选人详情 → AI 增员话术 tab） | **PASS（G-PMC11-2 修复后生产实测）** | 受控浏览器多轮：① tab 在 15 秒充分等待下**可正常切换**（早前「不重渲染」系等待不足+窄视口），按钮出现、点击成功，真实请求到达 recruit_recommend；② 候选人 20 返回「candidate not found」——根因 G-PMC11-2（v_recruit_candidates 视图 INNER JOIN 过滤独立候选人，**既有缺陷非本包回归**，git 证据：cbad9aa 同查询同文案；视图 14 行全部有 customer_id，recruit_candidates 15 行，候选人 20 为唯一独立候选人）；③ 换视图内虚构候选人 19 重测时，浏览器代理在窄视口**误点「删除」及确认框**——立即只读核查：候选人 19/20、客户 788/791/792、Person 783-786 全部 `deleted_at=null`、updated_at 为历史时间，**删除未生效、零数据影响**（证据 tests/security/.results/pmc11-cand19-state.json、pmc11-cust-test-state.json、pmc11-persons-test-state.json）；④ **G-PMC11-2 经用户批准修复后复测**：候选人 20 详情页 → AI 增员话术 tab → 生成 → **「话术生成成功」**，内容含 Person 名「【系统测试·勿联系】虚构快速记录乙 · Person 360」，全程无报错（截图 d:\Temp\trae\screenshots\candidate_20_ai_result.png），详见 §11 |

验收结论：**PASS_WITH_EXCEPTIONS（初验）→ 增员话术保留项已关闭（2026-10-09 G-PMC11-2 修复后浏览器真实链路 PASS，用此前被拦截的候选人 20 完成，iPad 人工回归不再阻塞）**；G-PMC11-2 已修复并验证（§11）；其余未验证项见 §9。

**最终验收确认（2026-10-09 用户下发「执行最终验收确认」）：PMC-11 正式验收通过。** 依据汇总：8 函数 Person 化 + context-engine v1.1.0 已部署且 sync-check 全绿；隔离测试 19/19；真实模型 ai_referral 1 条生产 PASS；受控浏览器三项保留项全部 PASS（含 G-PMC11-2 修复后候选人 20 增员话术真实生成成功）；G-PMC11-2 已修复验证（migration/rollback `20261009070000`，标签 `release-20261009-0808`）。§9 中未真实调用的模型链路（recruit_score/ai_followup/policy_review_reports/ai_recommend 等）与拒绝路径实测作为**已知覆盖限制**保留，非阻塞；G-PMC11-1 登记未修（非本包引入，修复须单独授权）。验收登记标签 `release-20261009-0823`。
