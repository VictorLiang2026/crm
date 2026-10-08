# PMC-10 证据（evidence/PMC-10）

## 1. 包概述

- 包名：PMC-10｜Today、任务、漏斗和统计的身份来源统一（任务展示和经营统计的 Person 来源切换）
- 前置：PMC-09 已验收
- 执行日期：2026-10-08
- 状态：待用户验收

## 2. 影响说明（编码前已确认）

- **展示层切换**：人物姓名展示改用 `persons.display_name`（权威来源，execution-contract F），`customer_name` 仅作未映射/未同步时的回退。
- **统计口径完全不动**：销售（customers/opportunities）、招募（recruit_candidates/recruit_followups）、活动（activities/activity_tasks）统计继续依据各自业务状态和业务记录；不以 person_roles 的简单存在代替真实经营阶段。
- **不变项**：优先级、到期、日期分桶（overdue/today/upcoming/unscheduled）、销售阶段、招募阶段、去重（DISTINCT ON）和统计口径全部保持；不新增推荐算法，不改变"下一步行动"业务规则。
- **切换方式**：SQL 层（v_action_center 视图 COALESCE JOIN persons）+ JS 层（today_coach/activity_reports/activity_tasks 内存 personNameMap 覆盖展示名，不动统计字段）。

## 3. 变更清单

| 文件 | 变更类型 | 说明 |
| --- | --- | --- |
| `cloudbase/migrations/20261008223000_pmc10_action_center_person_names.sql` | 新增 | `v_action_center` CREATE OR REPLACE：6 个 UNION ALL 分支中 5 个人物分支（customer/followup/opportunity/recruit/recruit_followup）加 persons LEFT JOIN（均带 `AND p*.deleted_at IS NULL`），person_name/title 改为 `COALESCE(pN.display_name, cN.customer_name, ...)`；activity_task 分支（活动名）不变；过滤/排序/列名/列序/列类型全部不变 |
| `cloudbase/rollbacks/20261008223000_pmc10_action_center_person_names_rollback.sql` | 新增 | rollback：恢复原视图定义（无 persons JOIN）+ COMMENT 置空（未执行，备用） |
| `cloudfunctions/today_coach/index.js` | 修改 | loadAll() 增加 persons 查询（第 13 项）+ customers select 加 person_id；personNameMap 覆盖 customer_name（统计字段不动），覆盖点 L250/335/456/476/516/906/910 自动生效 |
| `cloudfunctions/activity_reports/index.js` | 修改 | customerReport() Promise.all 增加 personsR 查询 + customers select 加 person_id；custName map 用 Person 名覆盖 + feed 显示名 6 处使用覆盖后姓名 |
| `cloudfunctions/activity_tasks/index.js` | 修改 | enrichRelated() customer 分支改为经 persons 取 display_name（customer_name 回退）；recruit 分支经 v_recruit_candidates 不变 |

## 4. 部署

| 项 | 时间 | 状态 |
| --- | --- | --- |
| migration 执行（v_action_center 重建） | 2026-10-08 | 成功（RESULT success:true） |
| today_coach 函数部署 | 2026-10-08 | 成功（函数代码更新成功） |
| activity_reports 函数部署 | 2026-10-08 | 成功（函数代码更新成功） |
| activity_tasks 函数部署 | 2026-10-08 | 成功（函数代码更新成功） |

## 5. 切换前后对比验证（核心验收证据）

### 5.1 快照对比（脱敏：只记 count/distinct_names/NULL，不输出真实姓名）

| action_type | before n | after n | before distinct_names | after distinct_names |
| --- | --- | --- | --- | --- |
| activity_task | 3 | 3 | 1 | 1 |
| customer | 1 | 1 | 1 | 1 |
| followup | 156 | 156 | 156 | 156 |
| opportunity | 1 | 1 | 1 | 1 |
| recruit | 4 | 4 | 4 | 4 |
| recruit_followup | 1 | 1 | 1 | 1 |
| **合计** | **166** | **166** | — | — |

- rows_with_null_person_name：before=0，after=0
- 证据文件：`tests/security/.results/pmc10-before-snapshot.json`、`tests/security/.results/pmc10-after-snapshot.json`
- **结论：总数、分组、排序口径（同条件同语句）差异为零**。

### 5.2 姓名内容零差异核查

`tests/security/.results/pmc10-mismatch-breakdown.json`：

| 项 | 值 | 说明 |
| --- | --- | --- |
| mismatch_among_mapped | **0** | 已映射 person_id 的客户，display_name 与 customer_name 完全一致 → 切换后展示内容零变化 |
| mismatch_among_unmapped | 3 | PMC-01 U1 未映射客户（A1–A3），COALESCE 按设计回退 customer_name（保持旧行为） |
| mismatch_total | 3 | 全部可解释 |

`tests/security/.results/pmc10-consistency-check.json`：

| 项 | 值 | 说明 |
| --- | --- | --- |
| customers total | 782 | 与 PMC-09 一致 |
| no_person_mapped | 3 | 即 U1（A1–A3），回退路径 |
| name_mismatch | 3 | 与未映射完全重叠 → 已映射部分差异为零 |
| dup_person_rows（同 person_id 多 customers） | **0** | person_id UNIQUE 成立，JOIN 不放大行数 |
| cust_with_multi_candidates（同客户多 recruit_candidates） | **0** | 招募分支无重复计数 |

### 5.3 多角色重复计数检查结论

- customers.person_id UNIQUE（PMC-05 建立且经上表核实 dup=0）→ 1:1 LEFT JOIN，任何分支都不会因 Person 放大行数。
- before/after 分组计数逐项相等（5.1）为最终事实证据。

## 6. 无影响证据（核实后不修改）

| 函数/视图 | 核查方式 | 结论 |
| --- | --- | --- |
| funnel_insight/index.js | grep：只读 v_funnel_stats 计数列（funnel/stage/current_count 等），无姓名引用 | 无影响，不修改 |
| v_funnel_stats 视图 | 定义为纯计数视图，无姓名列 | 无影响，不修改 |
| activity_topics/index.js | grep：无 customer_name/persons 引用 | 无影响，不修改 |
| assistant/index.js | grep：无 customer_name 引用 | 无影响，不修改 |

- 漏斗统计（funnel_insight）读取的是 v_funnel_stats 计数列，视图定义未改动，统计口径不变。

## 7. 不变项

- v_action_center：列名/列序/列类型、过滤条件、排序、日期分桶 CASE 表达式全部不变（migration 仅改 SELECT 内姓名表达式）
- today_coach：优先级/到期/分桶/去重/下一步行动规则不变；仅展示姓名来源覆盖
- activity_reports：totals/daily/avg/overdueNow/goalProgress 统计字段全部不动；仅 feed/新增客户显示名覆盖
- activity_tasks：CRUD/排序/状态机不变；仅 related_name 回填来源
- 前端（admin.html/console.html）：不修改
- RLS 策略：不变

## 8. 未验证项

- 线上 invoke 测试未执行（tcb fn invoke Cam authentication failed，既有已知限制）；以语法检查 + 部署成功 + 数据库快照对比代替
- iPad 端 Today/行动中心/漏斗/活动量页面人工回归待用户验收
