# Person 中心化迁移：设计

状态：PMC-00 建立骨架（2026-10-07）。本文件记录当前权威数据源（接管时已核实）与逐包设计；各包开始时必须重新核对线上事实，本文件内容不替代实时基线核对。未收到指令的包不预写设计。

## 一、当前权威数据源（2026-10-07 接管核实）

### 身份与人物

| 数据 | 权威来源 | 说明 |
| --- | --- | --- |
| Person 基础身份 | `public.persons` | 实测 784 行（2026-10-07 只读 count；2026-10-02 规划基线为 779）。姓名解析唯一服务端入口 `PersonService.resolveName()`，候选身份必须人工确认 |
| 客户角色 | `public.customers` | Legacy 客户域主表；软删除 + 同一 deleted_at 时间戳级联（回收站语义） |
| 增员候选人 | `public.recruit_candidates` / `recruit_followups` | Legacy 增员域；Person-only 招募与客户角色的关系按后续包设计 |
| 活动 | `public.activities` 及参与者/嘉宾/讲者表 | 活动客户经 WP04 映射到 Person；客户 #786 与姓名暂存参与者 #14 为已登记身份待核对例外 |
| 互动 | `public.interactions` | RLS 仅 `service_role` 可 SELECT；云函数经 `person_360`（`CRM_PERSON360_DB_API_KEY`）委托查询，匿名 `rdb()` 直查会 permission denied |
| 机会 | `public.opportunities` | Person 专属机会与旧 customer 机会权限隔离（WP10 已验收） |
| 行动/承诺 | `public.actions` / `public.commitments` | `source` 字段仅接受小写字母/数字/下划线；旧来源经 `v_action_center` 可见 |
| 结果/学习 | `public.outcomes` / learnings | 与 AI 反馈（`ai_results`）的关联按 WP21 线设计 |
| AI 审计 | `public.ai_tasks` / `ai_runs` / `ai_results` | 含敏感快照，仅 `service_role`；不照搬旧表匿名 CRUD |
| 事实/信号 | Fact / Signal / Inference 相关表 | 2026-10-02 盘点已建底座表；样本与确认状态规则见 target-crm-v1 design |

### 视图与权限要点

- **2026-10-07 PMC-01 实测基线（替换下列 2026-10-02 旧盘点）**：`public` 47 表、12 视图、33 个数据库函数、66 条外键、36 个序列、91 个触发器；47/47 表启用 RLS（41 表单策略、6 表多策略），12/12 视图启用 `security_invoker`；云端 54 函数 = 28 CRM + 26 `pr_*`。证据：`tests/security/.results/pmc01-catalog-20261007.json`（gitignored）+ [impact-matrix.md](impact-matrix.md) PMC-01 节。
- 2026-10-02 旧盘点记录（保留备查，已被上方取代）：`public` 37 表、10 视图、28 个 CRM 云函数；37/37 表启用 RLS，10/10 视图启用 `security_invoker`。每次涉及基表改列必须重建依赖视图（`pg-view-rebuild-check` skill）。
- 新增视图不授权给 authenticated；新表必须加 `*_fn_only` RLS 策略（AI Runtime 底座表按例外走 service_role）。
- 环境中另有 26 个 `pr_*` 函数与 `pr` schema——一律禁入，发现依赖即停止报告。

### 前端

- Legacy：`admin.html` 单文件（hash 路由 10 条），`callFn` 唯一数据入口。
- 新 AI-native Console：`crm/console.html` + `crm/js/modules/console/`（i18n 字典 `i18n.js`，`t(key)` 双语）；复用 `crm/js/core/`、`crm/js/components/`、`crm/css/`。
- ~~注意：`tests/wp01/static.cjs` 一致性爬虫只从 `admin.html` 出发遍历 import，`console.html` 模块链不在 sync-check 覆盖内~~（**已于 2026-10-07 PMC-00 G4 核实为过时记录并更正**：`static.cjs` 的 PAGES 早已含 `console.html`，50 受检资产 = 2 HTML + 48 个 console 模块链；证据见 [evidence/PMC-00.md](evidence/PMC-00.md) 第九节 G4）。

### AI

- 模型由 CloudBase AI Gateway / 环境配置选择（当前业务代码只声明 capability）；AI 写操作 Command → Plan → 服务端 Preview → 人工 Confirm → 有范围授权 Execute。
- **PMC-11（2026-10-08 开发，2026-10-09 已验收）AI 上下文身份设计**：
  1. **基础资料统一取 Person**：各 AI 入口经 `customers.person_id` / `recruit_candidates.person_id` / `activity_participants.canonical_person_id` 从 persons 读取 8 个基础字段（display_name、gender、birthday、phone、wechat、occupation、organization、education）；查询均带 `deleted_at IS NULL`。
  2. **业务上下文不搬家**：销售（customer_stage/sales_priority/annual_income/hobbies/marital_status/children/properties 等）、招募（各 priority/stage、mbti、motivation、concerns、work_experience、personality_tags、career_plan 等）、保险（products/policy_review_reports）、互动（followups/interactions）、活动（stage/席位/出席）继续各取所属业务表；嘉宾名取嘉宾域。
  3. **缺失/冲突显式标注，禁止 AI 猜测**：统一 identity helper（loadPersonIdentity）输出 `{source, person_id, unmapped, conflicts[]}`；未映射或 Person 缺失时回退旧表值并在 user 消息最前面插入固定 unmapped 提示；双源非空不一致时列冲突项并指令以 Person 为准。
  4. **搜索与候选引用**：服务端固定模板 + 白名单视图 `public.crm_search_people_v1`，refs 用 persons 准确 ID；模型不生成 SQL、不按姓名自选；context-engine 活动复盘身份解析 canonical_person_id 优先、外键精确回退，姓名永不是身份证据。
  5. **派生数据身份与更新/失效策略**：AI 摘要、上下文快照、建议/报告均为派生于请求时点的派生数据——身份以当时引用的 person_id 为准，展示名随快照留存。策略：①历史 ai_recommendations 行、ai_tasks/ai_runs/ai_results 快照保持当时事实，不批量改写、不做失效重算（时点事实本就是审计要求）；②新请求一律实时经 person_id 构建上下文，天然失效、无需缓存作废动作；③检索索引层不重建，listAll 关键词在服务端同时匹配 Person 当前名与行内历史快照名（改名后仍可被当前名检索到，返回行保持历史内容）；④新写入建议/报告的快照名取 Person 当前名。
  6. **非模型入口同权改造**：ai_recommendations 手工 create/listAll 不走 prompt，直接在服务端写/读路径做 Person 取名与双名搜索；模型配置方式、人工确认链、AI 自动写权限、Legacy Quick Capture 灰度均不变。

## 二、逐包设计

每个 PMC 包的详细设计在收到用户指令后登记于此；每包含：目标、涉及对象（表/视图/函数/action/页面）、字段与权限变化、兼容方向（Legacy 保留方式）、回归范围、migration/rollback 方案要点。

| 包 | 设计状态 | 摘要 |
| --- | --- | --- |
| PMC-00 | 已完成 | 接管检查 + 档案建立，无业务变更；见 [evidence/PMC-00.md](evidence/PMC-00.md) |
| PMC-01 | 已完成（纯只读盘点） | 全量影响盘点：无业务设计变更；产出为 [impact-matrix.md](impact-matrix.md) PMC-01 节（47 表/12 视图/33 函数实测、字段重复与一致性统计、66 FK 分类、视图依赖、28 函数 × action 矩阵、5 专项调用链核查、未知项 U1–U8）；见 [evidence/PMC-01.md](evidence/PMC-01.md) |
| PMC-02 | **已验收（2026-10-07）** | 目标数据模型与接口契约：新建 [data-model.md](data-model.md)——persons 为主实体不重命名、ID 精度契约（int8 字符串传输 R-ID1~5）、逐表字段归属字典与争议字段裁决（收入/需求/性格/标签/来源/备注）、三层资料与快照不可变、角色基数（person_roles UNIQUE(person_id,role)）与软删除兼容、customers.person_id 关联设计与 legacy_customer_id 退出条件、受影响 action 新旧契约（C1–C9 + 适配类型 T1/T2/T3）、阶段权威来源（0–4）与切换/部署/回滚次序；**D1–D11 已获用户全部按建议 A 批准**（D5/D8 路径批准，退出动作届时单独授权）；见 [evidence/PMC-02.md](evidence/PMC-02.md) |
| PMC-03～PMC-10 | 已实施（其中 PMC-03～09 已随各包验收，PMC-10 已验收） | 逐包设计落地于各包 evidence 与 impact-matrix 对应分节；本表不回溯扩写 |
| PMC-11 | **已验收（2026-10-09 用户最终确认）** | AI 上下文/搜索/结果保存适配 Person：8 个 AI 函数（ai_activity、ai_recommend、ai_referral、ai_followup、policy_review_reports、recruit_score、recruit_recommend、ai_recommendations）+ context-engine v1.1.0（两副本）；identity helper 模式（基础 8 字段取 Person、未映射回退+禁猜测、冲突标注）、业务域字段不动、非模型保存入口 create/listAll 改造、历史快照不改写；本包函数代码无 migration；验收中修复既有缺陷 G-PMC11-2（migration `20261009070000`：v_recruit_candidates 双视图 LEFT JOIN + persons 兜底姓名，独立候选人恢复可见，+ rollback）；隔离测试 19/19 + 真实模型 ai_referral 1 条 PASS + 增员话术候选人 20 修复后真实生成 PASS；详见上文 §一「AI」第 2 组设计与 [evidence/PMC-11.md](evidence/PMC-11.md) |
| PMC-12～PMC-20 | 未收到指令 | 不预写；收到指令后逐包登记完整指令与验收范围 |

## 三、迁移总体取向（已确认原则，非实施授权）

1. 收敛"身份权威"不等于搬空业务字段：业务表保留业务状态/外键，Person 持有基础信息；查询时以视图/服务端 join 呈现统一事实。
2. 历史快照（审计、AI 上下文快照、解析快照）保持不可变，与当前基础信息分开读取。
3. 身份合并仅允许"人工确认候选"路径；提供 merge 前的dry-run 预览与可回滚记录是后续相关包的最低要求（具体以该包指令为准）。
4. 每一步兼容方向：旧入口先保留、新入口验收后按 WP27/WP28 式证据流程收敛；PMC 范围内的退出/删除动作必须单独批准。
