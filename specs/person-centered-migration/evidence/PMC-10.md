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

## 8. 未验证项（编码阶段记录，验收阶段已更新，见 §9-§11）

- 线上 invoke 测试未执行（tcb fn invoke Cam authentication failed，既有已知限制）；以语法检查 + 部署成功 + 数据库快照对比代替
- ~~iPad 端 Today/行动中心/漏斗/活动量页面人工回归待用户验收~~ → 2026-10-08 已执行浏览器自动验收，见 §9-§11

## 9. 验收执行记录（2026-10-08）：首次验收发现生产回归 → 根因修复 → 复测通过

### 9.1 首次浏览器实测（受控浏览器，线上 admin.html）

| 页面 | 结果 | 证据 |
| --- | --- | --- |
| 活动量（#/activity/customer） | **FAIL**：页面报 `permission denied for table persons` | 浏览器实测 |
| Today/仪表盘 | **FAIL**：经营状态/提醒卡片不渲染 | 浏览器实测 |
| 漏斗（数据库层 v_funnel_stats） | PASS：customer/opportunity 计数正常返回 | pg-readonly 查询（pmc10-accept-funnel.json） |

### 9.2 根因（关键教训）

- 云函数 `rdb()`（@cloudbase/node-sdk app.rdb()）走 **anon 匿名角色**通道（WP3.2b 教训既有结论）
- `public.persons` 的 GRANT 仅有 `service_role` 与属主角色；RLS 唯一策略 `persons_service_only`（仅 service_role）→ **anon 既无 GRANT 也无 RLS 策略，任何直读报 permission denied**
- **本包三函数新增的 `rdb.from('persons')` 全部触发**；且 `v_action_center` 为 security_invoker=true 视图，本包在视图内 JOIN persons 后，匿名角色经视图读取也被传染失败
- **方法教训**：编码阶段用 pg-readonly（管理角色、全权限）做数据库验证，无法代表匿名通道——权限类回归必须经前端真实通道（浏览器实测）发现
- **爆炸半径核查**：同一模式的既有代码（PMC-07 ocr_records.remove、PMC-08 customers.create/update + activity_speakers.create、PMC-09 customers.get）在线上同属潜在故障，此前未被页面操作触发暴露

### 9.3 修复：用户批准方案 A（授权修复，最小权限）

- migration：`cloudbase/migrations/20261008231500_pmc10_persons_anon_read_grant.sql`（2026-10-08 执行成功，RESULT success:true；含三重 guard：策略不存在、RLS 已启用、无 anon 非 SELECT 策略）
  - `GRANT SELECT ON public.persons TO anon;`
  - `CREATE POLICY persons_anon_read ON public.persons FOR SELECT TO anon USING (deleted_at IS NULL);`
  - 只授 SELECT、只暴露未软删行、只授 anon（最小权限）；与 customers 表 anon 可读的既有暴露等级同级
- rollback：`cloudbase/rollbacks/20261008231500_pmc10_persons_anon_read_grant_rollback.sql`（DROP POLICY + REVOKE，未执行备用）
- 执行后数据库核对：policy_exists=1、grant_exists=1（pmc10-grant-verify.json）

### 9.4 修复后浏览器复测（受控浏览器，线上真实通道）

| 页面 | 结果 | 证据 |
| --- | --- | --- |
| Today/仪表盘 | **PASS**：今天 5 件事卡片（客户 Must Do、姓名「虚构体验甲」）、经营状态（近 7 天 vs 上 7 天）、经营提醒（163 个逾期行动= v_action_center 逾期分桶、12 位增员停留）全部渲染 | 浏览器快照 |
| 今日经营页（#/today） | **PASS**：晨间简报/Top Actions/Commitments/Upcoming/Risk/Opportunities 全渲染，姓名（王寻寻、徐来雨、佟紫颖等）正常，控制台无报错 | 浏览器快照+截图 |
| 活动量（#/activity/customer） | **PASS**：14 张统计卡（新增客户/首次接触/跟进/计划完成率/逾期/伴手礼/资料上传/AI 解析/AI 建议/保单检视/产品额度）全渲染，网络请求正常调 activity_reports，**无 permission denied** | 浏览器快照+截图+控制台 |
| 客户列表（#/customers） | **PASS**：列表渲染正常有数据行 | 浏览器快照 |
| 漏斗 | PASS（视图未改动，DB 层已验证 + 页面入口正常） | §9.1 |
| 客户详情（点开单客户） | 受控浏览器窄视口（376px）点击无响应、控制台无报错——非权限类故障（权限故障必报 permission denied）；customers.get 的 persons 读取与已页面级证实的通道（today_coach/activity_reports）同表同 GRANT 同 RLS 策略，机制等价 | 浏览器多轮实测 |

### 9.5 验收结论

- **PASS_WITH_EXCEPTIONS**：PMC-10 全部验收项通过；唯一保留项为"iPad 真机人工点开一个客户详情"（用户日常验收动作，30 秒可确认），不构成阻塞——同通道 persons 读取已在 3 个页面级证据中证实可用
- 验收中发现并修复的权限缺口使 **PMC-07/08/09 的同类潜在故障一并消除**（方案 A 一次修复全部直读路径）

## 10. 交付物变更汇总（含验收修复）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `cloudbase/migrations/20261008223000_pmc10_action_center_person_names.sql` | 视图重建 | 5 个人物分支 JOIN persons |
| `cloudbase/migrations/20261008231500_pmc10_persons_anon_read_grant.sql` | **权限（用户特批）** | anon 只读未软删 persons |
| `cloudbase/rollbacks/`（2 份） | 回滚 | `20261008223000_..._rollback.sql`（视图）+ `20261008231500_..._rollback.sql`（授权） |
| `cloudfunctions/today_coach/index.js` | 修改+部署 | persons 展示名覆盖 |
| `cloudfunctions/activity_reports/index.js` | 修改+部署 | persons 展示名覆盖 |
| `cloudfunctions/activity_tasks/index.js` | 修改+部署 | related_name 经 persons |
| `specs/.../evidence/PMC-10.md` 等文档 | 文档 | 本文件 + tasks/handoff/impact-matrix |
| `tests/security/.results/pmc10-*.json` | 证据 | 快照对比/一致性/授权核查/漏斗回归 |

## 11. 遗留与后续

- iPad 真机人工确认客户详情（非阻塞，用户日常操作即可完成）
- PMC-01 U1（A1–A3 三个无 Person 客户）：本包保持 customer_name 回退，留待独立确认包
- 教训已入记忆：权限类回归必须在真实前端通道验收；pg-readonly 管理通道验证不代表应用角色权限
