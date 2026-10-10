# Evidence: PMC-19 旧字段及兼容对象清理提案

状态：**提案完成，待用户审阅逐项批准表**。
执行工具：Trae。
基线：`release-20261010093000`（PMC-17 验收后）。
实测日期：2026-10-10。
执行约定：[execution-contract.md](../execution-contract.md) A–N。

---

## 1. 范围

PMC-19 = 旧冗余字段及兼容对象清理**提案和逐项审批**。
- **本包只制定方案，不执行删除、改名、停用或清理。**
- 五项任务：盘点清单 → 5 条证明 → 真实冗余 vs 必要快照区分 → 变更SQL/恢复/部署/回归 → 小批次+逐项批准表。
- 产物：[pmc-19-cleanup-proposal.md](../pmc-19-cleanup-proposal.md)（主提案）。

---

## 2. 盘点方法

- **实地查询**（2026-10-10，`tools/pmc-19-catalog.sql` 经 `tcb-exec.cjs` service_role）：12 个 CTE 查询覆盖约束/列/触发器/视图依赖/数据计数。
- **代码扫描**：`cloudfunctions/` 全量 grep（legacy_customer_id/触发器函数名/recruit 死列名）+ `admin.html` grep。
- **视图定义**：读取 migration 文件中的 CREATE VIEW 语句，确认列来源（persons vs customers vs recruit_candidates）。
- **设计/决策基线**：data-model.md §2/§5/§8、decisions.md D5/D8/PMC-17 裁决。

---

## 3. 候选对象实测结果

### 3.1 约束状态（catalog c1）

| 约束名 | 类型 | 定义 | 状态 |
| --- | --- | --- | --- |
| customers_person_id_fkey | FK | FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT | 在效（PMC-05） |
| customers_person_id_key | UNIQUE | UNIQUE (person_id) | 在效（PMC-05） |
| 客户列表_Id_key | UNIQUE | UNIQUE ("Id") | 在效 |
| 客户列表_pkey | PK | PRIMARY KEY ("Id") | 在效 |
| **客户列表_姓名_key** | **UNIQUE** | **UNIQUE (customer_name)** | **在效（CL-01 目标）** |

### 3.2 列状态

| 表.列 | 类型 | NOT NULL | 说明 |
| --- | --- | --- | --- |
| customers.person_id | bigint | ✅ true | PMC-17 落实 NOT NULL |
| persons.legacy_customer_id | integer | ❌ false | 可空，UNIQUE |
| customers.customer_name | text | ✅ true | 副本（权威=persons.display_name） |
| customers.phone/birthday/gender/occupation/education/wx_account | 各类型 | ❌ false | 7 副本列 |
| **recruit_candidates.education** | text | ❌ false | **死列（0 非空）** |
| **recruit_candidates.mbti** | text | ❌ false | **死列（0 非空）** |

### 3.3 复合 FK 状态（catalog c4）

| 约束名 | 子表 | 定义 |
| --- | --- | --- |
| opportunities_customer_person_fk | opportunities | FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT |
| recruit_candidates_customer_person_fk | recruit_candidates | 同上 |

### 3.4 触发器状态（catalog c8）

| 触发器名 | 表 | 事件 | 函数 | 说明 |
| --- | --- | --- | --- | --- |
| crm_person_role_customers_sync | customers | AFTER INSERT/DELETE/UPDATE OF person_id,deleted_at | crm_person_role_sync_v1() | PMC-15 派生角色 |
| crm_person_role_participants_sync | activity_participants | 同上 | 同上 | PMC-15 |
| crm_person_role_persons_sync | persons | AFTER UPDATE OF legacy_customer_id,deleted_at | 同上 | PMC-15 |
| crm_person_role_recruits_sync | recruit_candidates | 同上 | 同上 | PMC-15 |
| crm_person_role_speakers_sync | activity_speakers | 同上 | 同上 | PMC-15 |
| **customer_person_identity_bridge_trigger** | **customers** | AFTER UPDATE OF 7 base fields | **customer_person_identity_bridge()** | **CL-08 目标（PMC-17 保留为投影兜底）** |
| **recruit_candidate_person_sync_trigger** | **recruit_candidates** | BEFORE INSERT/UPDATE OF customer_id,person_id | **recruit_candidate_person_sync()** | **CL-09 目标（Legacy 自动建 Person）** |

### 3.5 视图依赖（catalog c9）

读 customers 副本列的 11 视图：customers_view、followups_view、gifts_view、photos_view、products_view、ai_recommendations_view、v_action_center、v_recruit_candidates、v_recruit_candidates_person_only、v_recruit_candidates_person_only_trash、v_recruit_candidates_trash。

### 3.6 数据计数（catalog c10）

| 指标 | 值 |
| --- | --- |
| persons 总行 | 787 |
| persons 活跃 | 784 |
| customers 总行 | 783 |
| customers 活跃 | 782 |
| customers 有 person_id | 783 |
| customers 无 person_id | 0 |
| opportunities 总行 | 9 |
| recruit_candidates 总行 | 18 |
| persons 有 legacy_customer_id | 783 |
| 重复活跃客户名 | 0（null=无重复） |
| recruit_candidates person_id 非空 | 18/18 |
| recruit_candidates customer_id 非空 | 17/18（1 行独立候选人） |

### 3.7 recruit_candidates 列空洞（catalog c7）

attnum 3–9, 14, 20 = `........pg.dropped.N........`（8 个已删除列空洞，20260905 重构遗留）。无数据、无代码、无视图读取。

### 3.8 代码引用扫描

| 搜索词 | 命中文件数 | 说明 |
| --- | --- | --- |
| `legacy_customer_id` | 25 个 JS 文件 | 广泛引用（person-service.js/interaction-service.js/context-engine.js 等） |
| `customer_person_identity_bridge` | 0 个 JS 文件 | 纯 DB 触发器函数，无应用层引用 |
| `recruit_candidate_person_sync` | 0 个 JS 文件 | 同上 |
| `recruit_candidates.*(education\|mbti)` | 0 个 JS 文件 | 无代码按名引用 |
| admin.html `c.mbti`/`c.education` | 3 处 | 上下文为 **customers**（非 recruit_candidates） |

---

## 4. 清理候选清单（9 项 + 已排除）

| 编号 | 对象 | 批次 | 前置满足 | 批准状态 |
| --- | --- | --- | --- | --- |
| CL-01 | customers UNIQUE(customer_name)（D5） | B2 | ✅ | 待批准 |
| CL-02 | customers 7 副本列 | B3 | ❌（须阶段 3 视图重建） | 待批准（前置未满足） |
| CL-03 | persons.legacy_customer_id 列 | B4 | ❌（须 CL-04+CL-08） | 待批准（前置未满足） |
| CL-04 | opportunities/recruit_candidates 复合 FK（D8） | B4 | ❌（须读路径迁移+对账） | 待批准（前置未满足） |
| CL-05 | recruit_candidates.education 死列 | B1 | ✅ | 待批准 |
| CL-06 | recruit_candidates.mbti 死列 | B1 | ✅ | 待批准 |
| CL-07 | 已删除列空洞 | — | — | 不清理（已删除） |
| CL-08 | customer_person_identity_bridge 触发器 | B5 | ❌（须全量写路径经 PersonService） | 待批准（前置未满足） |
| CL-09 | recruit_candidate_person_sync 触发器 | B5 | ❌（须 PersonService 接入 recruit create） | 待批准（前置未满足） |

**已排除项**：activity_participants.person_name、activity_speakers 快照列、ocr_records.customer_snapshot（必要历史快照，D6 确认）；G-PMC11-1/G-PMC17-1（登记缺陷，非冗余对象）。

---

## 5. 真实冗余 vs 必要保留

### 真实冗余（前置满足，可清理）
- CL-05（education）：0 数据、0 消费者、权威在 persons/customers
- CL-06（mbti）：0 数据、0 消费者、权威在 customers
- CL-01（D5 约束）：前置①②③全满足

### 有活跃消费者（前置未满足，暂不清理）
- CL-02（7 副本列）：11 视图 + customers/index.js + PersonService 投影
- CL-03（legacy_customer_id）：25 JS 文件 + 复合 FK + 桥触发器
- CL-04（复合 FK）：opportunities/recruit_candidates 函数 + 视图
- CL-08（桥触发器）：legacy customers.update 绕过路径
- CL-09（recruit 同步触发器）：recruit_candidates.create 自动建 Person

### 必要历史快照（不清理）
- activity_participants.person_name、activity_speakers 快照列、ocr_records.customer_snapshot（D6 不可变）

---

## 6. 恢复方案验证

每项的恢复方案均符合 execution-contract E（"恢复方案必须能恢复真实值，不能仅 ADD COLUMN 创建空列"）：

| 项 | 恢复机制 | 恢复真实值？ |
| --- | --- | --- |
| CL-01 | ADD CONSTRAINT UNIQUE (customer_name) | ✅（约束非数据，恢复约束即恢复） |
| CL-02 | ADD COLUMN + UPDATE FROM persons 回填 | ✅（persons 权威数据完整） |
| CL-03 | ADD COLUMN + UPDATE FROM customers 回填 | ✅（customers.person_id 映射完整） |
| CL-04 | 重新 ADD 复合 FK | ✅（约束非数据） |
| CL-05 | ADD COLUMN education text | ✅（原始全 NULL=真实值，回填 NULL 即恢复） |
| CL-06 | ADD COLUMN mbti text | ✅（同上） |
| CL-08 | 从 migration 恢复 CREATE FUNCTION + TRIGGER | ✅（定义完整记录） |
| CL-09 | 从 migration 恢复 CREATE FUNCTION + TRIGGER | ✅（定义完整记录） |

---

## 7. 验收对照

| 指令条目 | 对应章节 | 完成 |
| --- | --- | --- |
| 1 独立清单（对象名/字段名/所属业务） | proposal §2 + §3 逐项 | ✅ |
| 2 每项 5 条证明 | proposal §3 各项"证明"表 | ✅ |
| 3 真实冗余 vs 必要快照分开 | proposal §4 | ✅ |
| 4 变更SQL/依赖/部署/加锁/备份/回滚/数据恢复/新增数据/回归 | proposal §3 各项 | ✅ |
| 5 小批次 + 逐项批准表 | proposal §5 + §6 | ✅ |
| 验收：每项有依据/恢复/批准状态 | proposal §6 | ✅ |
| 验收：未批准项默认不执行 | proposal 状态声明 + §6 | ✅ |
| 验收：不存在已暗中清理的对象 | 实测全部"在效" | ✅ |
| 验收：更新 decisions/提案/handoff | 本文件 + decisions + handoff | ✅ |

---

## 8. 发布

本包仅文档（pmc-19-cleanup-proposal.md + evidence/PMC-19.md + decisions/handoff/tasks 更新），无业务云端产物改变。发布标签见 §9。

---

## 9. 发布标签

发布标签 `release-20261010-161100`（提交 `44b5539`）；7 files +1014/-12；本地/远端/标签三端一致；云端产物未改变（仅文档包）。

---

## 10. CL-05/CL-06/CL-01 执行（用户批准 B1+CL-01）

状态：**已执行（2026-10-10，用户批准 B1+CL-01 全部）**。

用户原话"好的，执行吧"，AskUserQuestion 选择"B1+CL-01 全部（推荐）"=CL-05+CL-06+CL-01 共 3 项。

### 10.1 Migration 文件

| 项 | migration 文件 | rollback 文件 |
| --- | --- | --- |
| CL-05 | `20261010163000_pmc19_cl05_drop_recruit_education.sql` | `...rollback.sql` |
| CL-06 | `20261010163100_pmc19_cl06_drop_recruit_mbti.sql` | `...rollback.sql` |
| CL-01 | `20261010163200_pmc19_cl01_drop_customer_name_unique.sql` | `...rollback.sql` |

双备份：`cloudbase/migrations/` + `C:\Users\victor\cloudbase\migrations\` 各 6 份。

### 10.2 Pre-migration 基线（tcb-exec service_role，2026-10-10）

| 指标 | 值 | 满足条件 |
| --- | --- | --- |
| education 列存在 | 1 | ✅ 可删 |
| mbti 列存在 | 1 | ✅ 可删 |
| 客户列表_姓名_key 约束存在 | 1 | ✅ 可删 |
| 重复活跃客户名 | 0 | ✅ rollback 安全 |
| education 非空 | 0 | ✅ 死列 |
| mbti 非空 | 0 | ✅ 死列 |
| customers 总行 | 783 | 数据完整 |
| recruit_candidates 总行 | 18 | 数据完整 |

### 10.3 Migration 执行（tcb-exec --role cloudbase_postgres）

| 项 | SQL | 耗时 | 结果 |
| --- | --- | --- | --- |
| CL-05 | `ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS education;` | 8ms | ✅ AffectedRows=0 |
| CL-06 | `ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS mbti;` | 11ms | ✅ AffectedRows=0 |
| CL-01 | `ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS "客户列表_姓名_key";` | 16ms | ✅ AffectedRows=0 |

### 10.4 Post-migration 核对（tcb-exec service_role）

| 指标 | 期望 | 实测 | 结果 |
| --- | --- | --- | --- |
| education 列存在 | 0 | 0 | ✅ 已删 |
| mbti 列存在 | 0 | 0 | ✅ 已删 |
| 客户列表_姓名_key 约束存在 | 0 | 0 | ✅ 已删 |
| customers 总行 | 783 | 783 | ✅ 数据完整 |
| recruit_candidates 总行 | 18 | 18 | ✅ 数据完整 |
| customers_view 行数 | 783 | 783 | ✅ 视图正常 |
| v_recruit_candidates 行数 | 15 | 15 | ✅ 视图正常（活跃） |
| v_recruit_candidates_trash 行数 | 3 | 3 | 回收站视图正常（软删） |
| v_recruit_candidates 仍返回 education/mbti 列 | 是 | 是（text, null） | ✅ 列来自 persons/customers 非 rc |

### 10.5 代码回归

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| recruit_candidates 函数引用 education/mbti | grep `education\|mbti` cloudfunctions/recruit_candidates/ | 0 命中 ✅ |
| customers 函数引用 customer_name 唯一约束 | grep `customer_name.*unique\|客户列表_姓名` cloudfunctions/customers/ | 0 命中 ✅ |
| recruit_candidates FIELDS 包含 education/mbti | 读 index.js FIELDS 数组 | 不含 ✅（create/update 不写死列） |
| recruit_candidates 函数读来源 | 读 index.js list/get | `rdb.from('v_recruit_candidates').select('*')` 读视图 ✅ |
| 云函数调用回归 | tcb fn invoke | ❌ Cam 认证不可用（无 ~/.cloudbase 登录），无法调用；但函数代码未变且读取已验证视图，风险极低 |

### 10.6 回归结论

- **DB 级回归全部通过**：3 项 DDL 成功应用，列/约束已删，数据完整，视图正常。
- **代码级回归通过**：0 代码消费者，FIELDS 不含死列，函数读视图（已验证正常）。
- **功能调用受限**：tcb fn invoke 需 Cam 登录，当前环境无 `~/.cloudbase` 目录；本包为纯 DB 变更（无代码改动），函数未变且读取已验证视图，风险极低。
- **限制声明**：CL-01 功能验证（创建同名客户不报约束冲突）未做，因 Cam 认证不可用；约束已在 DB 级核实删除（constraint_exists=0）。
