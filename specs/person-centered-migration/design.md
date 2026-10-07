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

## 二、逐包设计

每个 PMC 包的详细设计在收到用户指令后登记于此；每包含：目标、涉及对象（表/视图/函数/action/页面）、字段与权限变化、兼容方向（Legacy 保留方式）、回归范围、migration/rollback 方案要点。

| 包 | 设计状态 | 摘要 |
| --- | --- | --- |
| PMC-00 | 已完成 | 接管检查 + 档案建立，无业务变更；见 [evidence/PMC-00.md](evidence/PMC-00.md) |
| PMC-01 | 已完成（纯只读盘点） | 全量影响盘点：无业务设计变更；产出为 [impact-matrix.md](impact-matrix.md) PMC-01 节（47 表/12 视图/33 函数实测、字段重复与一致性统计、66 FK 分类、视图依赖、28 函数 × action 矩阵、5 专项调用链核查、未知项 U1–U8）；见 [evidence/PMC-01.md](evidence/PMC-01.md) |
| PMC-02～PMC-20 | 未收到指令 | 不预写；收到指令后逐包登记完整指令与验收范围 |

## 三、迁移总体取向（已确认原则，非实施授权）

1. 收敛"身份权威"不等于搬空业务字段：业务表保留业务状态/外键，Person 持有基础信息；查询时以视图/服务端 join 呈现统一事实。
2. 历史快照（审计、AI 上下文快照、解析快照）保持不可变，与当前基础信息分开读取。
3. 身份合并仅允许"人工确认候选"路径；提供 merge 前的dry-run 预览与可回滚记录是后续相关包的最低要求（具体以该包指令为准）。
4. 每一步兼容方向：旧入口先保留、新入口验收后按 WP27/WP28 式证据流程收敛；PMC 范围内的退出/删除动作必须单独批准。
