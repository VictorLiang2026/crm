# PMC-19：旧冗余字段及兼容对象清理提案

状态：**提案（本包仅制定方案，不执行删除、改名、停用或清理）**。
基线：`release-20261010093000`（PMC-17 验收后）；实测日期 2026-10-10（工具 `tools/tcb-exec.cjs`，service_role 只读查询 + `tools/pg-readonly.cjs`）。
前置：PMC-18 已验收（用户 2026-10-10 授权提前验收，详见 [evidence/PMC-18.md](evidence/PMC-18.md) §7）。
执行约定：[execution-contract.md](execution-contract.md) A–N 十四条。

> **关键约束**：用户批准本迁移计划 ≠ 批准所有清理项。每项清理须在下方逐项批准表中获得明确批准状态。未批准项默认不执行。本提案不构成对任何已有表/视图/函数/路由删除动作的提前授权。

---

## 1. 盘点方法

- **实地查询**（2026-10-10，`tools/pmc-19-catalog.sql` 经 tcb-exec service_role）：核实约束/列/触发器/视图依赖/数据计数的当前状态。
- **代码扫描**：`cloudfunctions/` 全量 grep + `admin.html` grep，核实消费者。
- **视图定义**：读取 migration 文件中的 CREATE VIEW 语句，确认列来源。
- **设计基线**：[data-model.md](data-model.md) §2 字段归属字典、§5 legacy_customer_id 退出、§8 D5/D8 路径批准状态。
- **决策基线**：[decisions.md](decisions.md) D5/D8 路径批准、PMC-17 桥触发器保留裁决。

---

## 2. 候选对象总表

| 编号 | 对象 | 类型 | 所属业务 | 当前状态 | 真实冗余/必要保留 | 批次 |
| --- | --- | --- | --- | --- | --- | --- |
| CL-01 | `客户列表_姓名_key`（customers UNIQUE(customer_name)） | 约束 | 客户域 | 在效 | 真实冗余（前置已满足） | B2 |
| CL-02 | customers 基础 7 字段副本列（customer_name/phone/birthday/gender/occupation/education/wx_account） | 列 | 客户域 | 在效（副本） | 有活跃消费者（11 视图 + legacy 代码） | B3 |
| CL-03 | persons.legacy_customer_id 列 | 列 | 人物域 | 在效（可空 UNIQUE） | 复合 FK 锚点 | B4 |
| CL-04 | opportunities_customer_person_fk + recruit_candidates_customer_person_fk（复合 FK） | 约束 | 机会/招募域 | 在效 | 有活跃消费者（customer_id 列引用） | B4 |
| CL-05 | recruit_candidates.education（attnum 10） | 列 | 招募域 | 在效（死列） | 真实冗余（0 非空、零消费者） | B1 |
| CL-06 | recruit_candidates.mbti（attnum 11） | 列 | 招募域 | 在效（死列） | 真实冗余（0 非空、零消费者） | B1 |
| CL-07 | recruit_candidates 已删除列空洞（attnum 3–9/14/20） | 结构 | 招募域 | 已删除（pg.dropped） | 无数据无消费者 | 不清理（已删除） |
| CL-08 | customer_person_identity_bridge_trigger + 函数 | 触发器 | 客户域 | 在效 | PMC-17 保留为投影兜底 | B5 |
| CL-09 | recruit_candidate_person_sync_trigger + 函数 | 触发器 | 招募域 | 在效 | Legacy 自动建 Person（规则 9 保留） | B5 |

**已排除项（非本提案清理范围）**：
- activity_participants.person_name、activity_speakers.name/phone/wechat/organization/position：**必要历史快照**（D6 确认，不可变，不清理）。
- ocr_records.customer_snapshot：**必要恢复数据**（OCR 恢复链路依赖，不清理）。
- G-PMC11-1（ai_activity analyze top3 缺 ID 白名单）：**登记缺陷**，非冗余对象，不在本包范围。
- G-PMC17-1（crm_test_scenario_v1 触发器守卫白名单滞后）：**登记缺陷**，非冗余对象，不在本包范围。

---

## 3. 逐项详细方案

### CL-01：customers UNIQUE(customer_name) 约束解除（D5）

**对象**：`public.customers` 上的 `客户列表_姓名_key` 约束（`UNIQUE (customer_name)`）。
**所属业务**：客户域。
**设计依据**：[data-model.md](data-model.md) §5.3/D5；[decisions.md](decisions.md) D5 路径批准（2026-10-07，"解除动作须在独立包单独批准，不提前授权"）。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | Person 或正确领域已有完整权威数据 | persons.display_name 为姓名权威（data-model §2.1）；customers 783/783 行均已关联 person_id（catalog c10: customers_with_person=783, without_person=0） |
| 2 | 活跃及软删除/历史数据已按规则处理 | 活跃客户 782 行 + 软删 1 行，全部已关联 Person；重复活跃名 0 个（catalog c11: null=无重复） |
| 3 | 本地代码/线上函数/视图/RPC/任务/缓存无未处理依赖 | customers.create/update 已走 PersonService（PMC-17 落实）；视图读 customer_name 列（不依赖 UNIQUE 约束本身）；约束仅阻止重复名插入，解除后 create 需带 clientRequestId 去重（data-model C6） |
| 4 | 观察期无合法业务继续依赖 | 身份=person_id（非姓名）；PMC-17 落实 PersonService.resolveName 已替代姓名唯一性校验；无代码依赖"姓名唯一"做身份判断 |
| 5 | 不影响 pr 或 pr_* | 约束在 public.customers；不涉及 pr schema |

#### 变更方案

```sql
-- migration: ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS "客户列表_姓名_key";
-- rollback:  ALTER TABLE public.customers ADD CONSTRAINT "客户列表_姓名_key" UNIQUE (customer_name);
```

**注意**：rollback 需先校验无重复名（若有重复须先并档或标注）；回滚时若有重复名则 ADD CONSTRAINT 会失败。

#### 依赖处理
- **customers.create**：解除后须带 `clientRequestId`（uuid）做服务端去重（data-model C6）；PMC-17 customers.create 已不自动建 Person，走 resolveName 返回候选——无姓名唯一依赖。
- **视图**：11 视图读 customer_name 列（不依赖约束），无需重建。
- **代码**：无代码检查"姓名唯一约束"做业务逻辑。

#### 部署顺序
1. 应用 migration（DROP CONSTRAINT）
2. 部署 customers 函数（若需加 clientRequestId 去重逻辑——属后续包，本项仅解约束）
3. 回归测试

#### 加锁/停机风险
- DROP CONSTRAINT：`ACCESS EXCLUSIVE` 锁 customers 表，但操作极快（仅删 catalog 行，不扫数据）；生产 <10ms。
- 无停机风险。

#### 备份/回滚/数据恢复
- **备份**：约束定义已记录（`UNIQUE (customer_name)`）；无需数据备份。
- **回滚**：`ADD CONSTRAINT UNIQUE (customer_name)`——须先校验无重复名。
- **数据恢复**：约束删除不删数据；回滚恢复约束即可。无"恢复真实值"问题（约束非数据）。

#### 迁移后新增数据处理
- 新增客户不再受姓名唯一约束；走 resolveName 做身份解析（人工确认同名候选）。
- 重复名客户由人工并档或标注（D5 前置③已满足：当前 0 重复）。

#### 回归清单
- [ ] 客户列表/详情正常
- [ ] 客户创建（同名不同人）可创建
- [ ] 客户更新（改姓名）不报唯一约束冲突
- [ ] 回收站恢复正常
- [ ] 招募/嘉宾关联客户不受影响

---

### CL-02：customers 基础 7 字段副本列退出

**对象**：`public.customers` 上 `customer_name`(text NOT NULL)、`phone`(text)、`birthday`(date)、`gender`(text)、`occupation`(text)、`education`(text)、`wx_account`(text) 共 7 列。
**所属业务**：客户域。
**设计依据**：[data-model.md](data-model.md) §2.2 副本裁决、§2.9 同步方向总表、§6.5 阶段 4 副本列退出。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | Person 权威数据已存在 | persons.display_name/phone/birthday/gender/occupation/education/wechat 为权威（§2.1）；customers 783/783 行已关联 person_id |
| 2 | 活跃/历史数据已处理 | 活跃 782 + 软删 1 行全部有 person_id；persons 活跃 784 行（含 1 无客户角色 Person） |
| 3 | 无未处理依赖 | **不满足**：11 视图读这些列（catalog c9）；customers/index.js 读写副本列；PMC-17 PersonService.updateBasicsWithProjection 以副本列为投影目标 |
| 4 | 观察期无合法业务继续依赖 | **不满足**：PMC-17 设计为"投影回写"保留副本列；视图未改读 persons；阶段 3 视图重建尚未执行 |
| 5 | 不影响 pr | 仅 public.customers 列 |

**结论**：**前置不满足**，当前不可清理。须先完成阶段 3（视图改读 persons）+ 阶段 4（投影回写停止）。

#### 变更方案（未来执行时）

```sql
-- migration: 逐列 DROP（须在视图重建后）
ALTER TABLE public.customers DROP COLUMN IF EXISTS customer_name;  -- 须先取消 NOT NULL + 解除 UNIQUE（CL-01）
ALTER TABLE public.customers DROP COLUMN IF EXISTS phone;
ALTER TABLE public.customers DROP COLUMN IF EXISTS birthday;
ALTER TABLE public.customers DROP COLUMN IF EXISTS gender;
ALTER TABLE public.customers DROP COLUMN IF EXISTS occupation;
ALTER TABLE public.customers DROP COLUMN IF EXISTS education;
ALTER TABLE public.customers DROP COLUMN IF EXISTS wx_account;

-- rollback: 逐列 ADD + 从 persons 回填
ALTER TABLE public.customers ADD COLUMN customer_name text;
ALTER TABLE public.customers ADD COLUMN phone text;
-- ... (其余 5 列)
UPDATE public.customers c SET
  customer_name = p.display_name, phone = p.phone, birthday = p.birthday,
  gender = p.gender, occupation = p.occupation, education = p.education,
  wx_account = p.wechat
FROM public.persons p WHERE c.person_id = p.id;
ALTER TABLE public.customers ALTER COLUMN customer_name SET NOT NULL;
```

#### 依赖处理
- **11 视图**（customers_view/followups_view/gifts_view/photos_view/products_view/ai_recommendations_view/v_action_center/v_recruit_candidates×4）：须先重建为读 persons 列（COALESCE 或直接 JOIN）。
- **customers/index.js**：list/get 返回 customer_name 等须改从 persons JOIN。
- **PMC-17 PersonService**：updateBasicsWithProjection 须停止回写副本列。
- **customers.create**：不再写入副本列，直接写 persons + person_id。

#### 部署顺序
1. 重建 11 视图（改读 persons，列名不变）
2. 部署 customers + 7 子表函数（改读 persons）
3. 应用 migration（DROP 7 列）
4. 部署 PersonService 更新（停止投影回写）
5. 回归测试

#### 加锁/停机风险
- DROP COLUMN：`ACCESS EXCLUSIVE` 锁 customers 表；7 列分步 DROP 可降低单次锁时长。
- 视图重建：`CREATE OR REPLACE VIEW` 需 `SHARE` 锁，极快。
- **无停机**，但须在低峰期执行。

#### 备份/回滚/数据恢复
- **备份**：DROP 前导出 customers 7 列 + person_id 映射（`COPY (SELECT c."Id", c.person_id, c.customer_name, c.phone, ... FROM customers c) TO ...`）。
- **回滚**：ADD COLUMN + 从 persons 回填（`UPDATE ... FROM persons WHERE person_id=id`）。
- **数据恢复**：persons 数据完整（是权威来源），回填可恢复真实值。**满足 contract E（能恢复真实值）**。

#### 迁移后新增数据处理
- 新增客户直接写 persons + person_id，不写副本列。
- customers.create 返回的 customer_name 等字段由视图 JOIN persons 提供。

#### 回归清单
- [ ] 11 视图重建后列名/类型不变
- [ ] 客户列表/详情/跟进/礼品/照片/保单/AI推荐/动作中心/招募列表全量回归
- [ ] OCR 恢复链路正常
- [ ] 回收站正常
- [ ] PMC-17 PersonService 投影回写已停止

---

### CL-03：persons.legacy_customer_id 列退出

**对象**：`public.persons.legacy_customer_id`（integer，可空，UNIQUE）。
**所属业务**：人物域。
**设计依据**：[data-model.md](data-model.md) §5.4 生命周期 + 退出条件。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | 权威数据已存在 | customers.person_id（NOT NULL + UNIQUE + FK→persons.id）为权威关联（PMC-17 落实） |
| 2 | 活跃/历史数据已处理 | persons 783/787 行有 legacy_customer_id（catalog c10）；4 行无 legacy（1 无客户角色 Person + 3 由身份命令创建） |
| 3 | 无未处理依赖 | **不满足**：25 个 JS 文件引用 legacy_customer_id；复合 FK（CL-04）以它为锚点；桥触发器（CL-08）用 `WHERE p.legacy_customer_id=NEW."Id"` |
| 4 | 观察期无合法业务继续依赖 | **不满足**：复合 FK 未退出（CL-04 前置）；桥触发器未退出（CL-08 前置） |
| 5 | 不影响 pr | 仅 public.persons |

**结论**：**前置不满足**。CL-04（复合 FK 退出）+ CL-08（桥触发器退出）为前置依赖。

#### 变更方案（未来执行时）

```sql
-- migration: 须在 CL-04 + CL-08 退出后
ALTER TABLE public.persons DROP COLUMN IF EXISTS legacy_customer_id;
-- rollback:
ALTER TABLE public.persons ADD COLUMN legacy_customer_id integer;
-- 回填（从 customers."Id" 反查）
UPDATE public.persons p SET legacy_customer_id = c."Id"
FROM public.customers c WHERE c.person_id = p.id AND c.deleted_at IS NULL;
ALTER TABLE public.persons ADD CONSTRAINT persons_legacy_customer_id_key UNIQUE (legacy_customer_id);
```

#### 依赖处理
- **CL-04 前置**：复合 FK 引用 `persons(legacy_customer_id, id)`，须先 DROP 复合 FK。
- **CL-08 前置**：桥触发器函数 `WHERE p.legacy_customer_id=NEW."Id"`，须先 DROP 触发器。
- **25 个 JS 文件**：须逐个核实引用场景，改走 `customers.person_id` JOIN。

#### 部署顺序
1. CL-04 复合 FK 退出（替换为直接 FK→persons.id）
2. CL-08 桥触发器退出
3. 代码扫描确认无 legacy_customer_id 引用
4. 应用 migration（DROP COLUMN）
5. 回归测试

#### 加锁/停机风险
- DROP COLUMN：`ACCESS EXCLUSIVE` 锁 persons 表。
- **无停机**，低峰期执行。

#### 备份/回滚/数据恢复
- **备份**：DROP 前导出 `SELECT id, legacy_customer_id FROM persons`。
- **回滚**：ADD COLUMN + 从 customers 回填。
- **数据恢复**：customers.person_id→persons.id 映射完整（NOT NULL），可恢复真实 legacy_customer_id 值。**满足 contract E**。

#### 迁移后新增数据处理
- 新建 Person 不再设 legacy_customer_id（由身份命令创建的 Person 本就不设）。
- 旧 Person 的 legacy_customer_id 值保留在历史 migration 备份中。

#### 回归清单
- [ ] 25 个 JS 文件无 legacy_customer_id 引用
- [ ] 复合 FK 已替换为直接 FK
- [ ] 桥触发器已退出
- [ ] Person 创建/删除/恢复正常
- [ ] 客户/招募/机会/嘉宾/参与者全量回归

---

### CL-04：opportunities/recruit_candidates 复合 FK 退出（D8）

**对象**：
- `public.opportunities` 上 `opportunities_customer_person_fk`（`FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT`）
- `public.recruit_candidates` 上 `recruit_candidates_customer_person_fk`（同上）
**所属业务**：机会域 + 招募域。
**设计依据**：[data-model.md](data-model.md) §5.5/U5-U6/D8。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | 权威数据已存在 | opportunities 9 行、recruit_candidates 18 行均有 person_id（catalog c12: recruit person_id_non_null=18/18） |
| 2 | 活跃/历史数据已处理 | 全量行有 person_id；复合 FK 同时引用 customer_id + person_id |
| 3 | 无未处理依赖 | **不满足**：opportunities/index.js 用 customer_id 做查询；recruit_candidates/index.js 用 customer_id 做查询+插入；视图 v_recruit_candidates JOIN `c."Id" = rc.customer_id` |
| 4 | 观察期无合法业务继续依赖 | **不满足**：读路径未改走 person_id；双写对账未连续 N 周零差异 |
| 5 | 不影响 pr | 仅 public 对象 |

**结论**：**前置不满足**。D8 退出条件（4 条）均未达成。

#### 变更方案（未来执行时）

```sql
-- migration: 替换复合 FK 为直接 FK
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_customer_person_fk;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_person_fk
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT;

ALTER TABLE public.recruit_candidates DROP CONSTRAINT IF EXISTS recruit_candidates_customer_person_fk;
ALTER TABLE public.recruit_candidates ADD CONSTRAINT recruit_candidates_person_fk
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT;

-- rollback:
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_person_fk;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_customer_person_fk
  FOREIGN KEY (customer_id, person_id) REFERENCES persons(legacy_customer_id, id) ON DELETE RESTRICT;
-- recruit_candidates 同上
```

**注意**：customer_id 列本身退出（DROP COLUMN）属 CL-04 的延伸，须在直接 FK 替换 + 读路径迁移完成后另行批准。

#### 依赖处理
- **opportunities/index.js**：查询/创建/更新改走 person_id（data-model §6.4 双轨入参→单轨）。
- **recruit_candidates/index.js**：查询/创建改走 person_id；recruit_candidates.create 的 customer_id 传入须兼容（T2 适配）。
- **v_recruit_candidates 视图**：JOIN `c."Id" = rc.customer_id` 须改为 `p.id = rc.person_id`（或保留 LEFT JOIN customers 做客户域字段读取，但身份关联改走 person_id）。

#### 部署顺序
1. 部署 opportunities + recruit_candidates 函数（改走 person_id 查询，兼容旧入参）
2. 重建受影响视图
3. 应用 migration（DROP 复合 FK + ADD 直接 FK）
4. 回归测试
5. 对账连续 N 周零差异后，方可进入 CL-03（legacy_customer_id 列退出）

#### 加锁/停机风险
- DROP + ADD CONSTRAINT：`ACCESS EXCLUSIVE` 锁，但操作极快。
- **无停机**。

#### 备份/回滚/数据恢复
- **备份**：约束定义已记录。
- **回滚**：重新 ADD 复合 FK（须 legacy_customer_id 列仍在）。
- **数据恢复**：约束变更不删数据；回滚恢复约束即可。**满足 contract E**。

#### 迁移后新增数据处理
- 新增 opportunities/recruit_candidates 须带 person_id（已有 NOT NULL 约束）。
- customer_id 列保留（不删，仅解除复合 FK），兼容旧代码读取。

#### 回归清单
- [ ] 机会列表/详情/创建/更新正常
- [ ] 招募列表/详情/创建/更新正常
- [ ] 招募评分/推荐/漏斗正常
- [ ] 视图 v_recruit_candidates 重建后正常
- [ ] 对账 persons↔opportunities/recruit_candidates person_id 一致

---

### CL-05：recruit_candidates.education 列退出（死列）

**对象**：`public.recruit_candidates.education`（text，attnum 10）。
**所属业务**：招募域。
**设计依据**：[data-model.md](data-model.md) §2.3（education 为招募评估快照，不回写 persons）；G-PMC12-1 登记为死列。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | 权威数据已存在 | persons.education 为权威（§2.1）；v_recruit_candidates 读 `COALESCE(p.education, c.education)`——来自 persons/customers，**不读 rc.education**（PMC-12 视图定义 line 31） |
| 2 | 活跃/历史数据已处理 | **0 行非空**（catalog c6: education_non_null=0/18）；无历史数据 |
| 3 | 无未处理依赖 | 视图不读 rc.education；recruit_candidates/index.js `select('*')` 读全列但代码无按名引用 education；admin.html `c.education` 指向**customers**上下文（非 recruit_candidates） |
| 4 | 观察期无合法业务继续依赖 | 0 数据、0 写入者、0 读取者 |
| 5 | 不影响 pr | 仅 public.recruit_candidates |

#### 变更方案

```sql
-- migration:
ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS education;
-- rollback:
ALTER TABLE public.recruit_candidates ADD COLUMN education text;
-- 回填：无历史数据（0 非空），回填值为 NULL，与原始状态一致
```

**注**：rollback 恢复的列为空列，但原始数据本就全 NULL（0 非空），因此"恢复真实值"=恢复 NULL，符合原始事实。contract E 要求"能恢复真实值"——此列真实值即 NULL，回填 NULL 即恢复。

#### 依赖处理
- **v_recruit_candidates 视图**：不读 rc.education（读 COALESCE(p.education, c.education)），无需重建。
- **v_recruit_candidates_trash 视图**：不读 rc.education。
- **recruit_candidates/index.js**：`select('*')` 返回全列——DROP 后返回集少 1 列，但无代码按名引用该列。
- **admin.html**：`c.education` 是 customers 上下文，不涉及。

#### 部署顺序
1. 应用 migration（DROP COLUMN）
2. 回归测试（无需部署函数代码——无代码引用该列）

#### 加锁/停机风险
- DROP COLUMN：`ACCESS EXCLUSIVE` 锁 recruit_candidates 表（18 行），极快。
- **无停机**。

#### 备份/回滚/数据恢复
- **备份**：DROP 前确认 0 非空（已证实）；无需数据导出。
- **回滚**：ADD COLUMN education text（恢复空列，与原始一致）。
- **数据恢复**：原始真实值=全 NULL，回填 NULL 即恢复。**满足 contract E**。

#### 迁移后新增数据处理
- 新增 recruit_candidate 不再设 education（视图中从 persons/customers 读取）。

#### 回归清单
- [ ] 招募列表/详情正常（education 从 persons/customers 读取）
- [ ] 招募评分/推荐正常
- [ ] 招募回收站正常
- [ ] select('*') 返回集不含 education（前端无报错）

---

### CL-06：recruit_candidates.mbti 列退出（死列）

**对象**：`public.recruit_candidates.mbti`（text，attnum 11）。
**所属业务**：招募域。
**设计依据**：[data-model.md](data-model.md) §2.3（mbti 为招募评估快照，不回写 persons）；G-PMC12-1 登记为死列。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | 权威数据已存在 | customers.mbti 为客户域权威（D3 确认）；v_recruit_candidates 读 `c.mbti`——来自 **customers**，**不读 rc.mbti**（PMC-12 视图定义 line 33） |
| 2 | 活跃/历史数据已处理 | **0 行非空**（catalog c6: mbti_non_null=0/18）；无历史数据 |
| 3 | 无未处理依赖 | 视图不读 rc.mbti；recruit_candidates/index.js `select('*')` 但代码无按名引用 mbti；admin.html `c.mbti` 指向**customers**上下文 |
| 4 | 观察期无合法业务继续依赖 | 0 数据、0 写入者、0 读取者 |
| 5 | 不影响 pr | 仅 public.recruit_candidates |

#### 变更方案

```sql
-- migration:
ALTER TABLE public.recruit_candidates DROP COLUMN IF EXISTS mbti;
-- rollback:
ALTER TABLE public.recruit_candidates ADD COLUMN mbti text;
-- 回填：无历史数据（0 非空），回填值为 NULL，与原始状态一致
```

#### 依赖处理
- 同 CL-05（视图读 c.mbti 不读 rc.mbti；代码无按名引用）。

#### 部署顺序
1. 应用 migration（DROP COLUMN）
2. 回归测试

#### 加锁/停机风险
- 同 CL-05（18 行表，极快）。

#### 备份/回滚/数据恢复
- 同 CL-05（原始全 NULL，回填 NULL 即恢复真实值）。

#### 迁移后新增数据处理
- 新增 recruit_candidate 不再设 mbti（视图中从 customers 读取）。

#### 回归清单
- [ ] 招募列表/详情正常（mbti 从 customers 读取）
- [ ] 招募评分/推荐正常
- [ ] 招募回收站正常
- [ ] select('*') 返回集不含 mbti（前端无报错）

---

### CL-07：recruit_candidates 已删除列空洞（attnum 3–9/14/20）

**对象**：`pg.dropped.3` ~ `pg.dropped.9`、`pg.dropped.14`、`pg.dropped.20`（共 8 个结构空洞）。
**所属业务**：招募域。
**当前状态**：已通过 `ALTER TABLE DROP COLUMN` 删除（20260905 重构），PostgreSQL 保留 attnum 占位。

#### 说明
- 这些列**已删除**，无数据、无代码引用、无视图读取。
- PostgreSQL 的 attnum 空洞无法通过普通操作回收；只有 `VACUUM FULL` 可重建表物理结构，但需 `ACCESS EXCLUSIVE` 锁（阻塞所有读写）。
- **本项不列入清理候选**——已删除，无需再清理。
- 如未来需回收物理空间，`VACUUM FULL recruit_candidates` 属维护操作，须单独批准（18 行表空间极小，无实际收益）。

---

### CL-08：customer_person_identity_bridge 触发器退出

**对象**：
- 触发器 `customer_person_identity_bridge_trigger`（AFTER UPDATE OF customer_name/phone/wx_account/gender/birthday/occupation/education ON customers）
- 函数 `customer_person_identity_bridge()`（SECURITY DEFINER）
**所属业务**：客户域。
**设计依据**：[decisions.md](decisions.md) PMC-17 裁决（"桥触发器保留为投影兜底方向 Person→customers，非独立权威；移除须单独批准"）。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | 权威数据已存在 | persons 为基础字段权威（§2.1）；PMC-17 PersonService.updateBasicsWithProjection 以 persons 为权威源做正向投影（persons→customers） |
| 2 | 活跃/历史数据已处理 | customers 783/783 行已关联 person_id；触发器方向=customers→persons（**反向**），与 PMC-17 正向投影方向冲突 |
| 3 | 无未处理依赖 | **不满足**：触发器在效，legacy 写路径（不经过 PersonService 的直接 customers.update）依赖此触发器同步 persons |
| 4 | 观察期无合法业务继续依赖 | **不满足**：PMC-17 裁决"保留为投影兜底"；须先确保全量写路径经 PersonService |
| 5 | 不影响 pr | 仅 public 对象 |

**结论**：**前置不满足**。须先确保全量 customers 写路径经 PersonService（消除绕过路径），触发器方可退出。

#### 变更方案（未来执行时）

```sql
-- migration:
DROP TRIGGER IF EXISTS customer_person_identity_bridge_trigger ON public.customers;
DROP FUNCTION IF EXISTS public.customer_person_identity_bridge();
-- rollback:
CREATE FUNCTION public.customer_person_identity_bridge() RETURNS trigger ...  -- 从 migration 20261004011800 恢复
CREATE TRIGGER customer_person_identity_bridge_trigger ...  -- 同上
```

#### 依赖处理
- **customers/index.js update**：PMC-17 已改道 PersonService.updateBasicsWithProjection（经服务端映射写 persons + 回写副本列）。
- **admin.html 直调 customers.update**：须核实是否全量经 PersonService（若有绕过路径，须先迁移）。
- **桥触发器函数定义**：从 migration `20261004011800_person_directory_roles.sql` line 701–723 恢复。

#### 部署顺序
1. 全量写路径确认经 PersonService（代码审计 + 测试）
2. 应用 migration（DROP TRIGGER + DROP FUNCTION）
3. 回归测试

#### 加锁/停机风险
- DROP TRIGGER：极快（`ACCESS EXCLUSIVE` 但仅删 catalog 行）。
- **无停机**。

#### 备份/回滚/数据恢复
- **备份**：触发器+函数定义完整记录在 migration `20261004011800`。
- **回滚**：从 migration 恢复 CREATE FUNCTION + CREATE TRIGGER。
- **数据恢复**：触发器/函数不存数据；回滚恢复触发器即可。**满足 contract E**。

#### 迁移后新增数据处理
- 新增/更新 customers 经 PersonService，persons 直接写入（无需触发器回写）。

#### 回归清单
- [ ] customers.update 经 PersonService 正常
- [ ] customers.create 正常
- [ ] 客户列表/详情姓名/电话/微信/性别/生日/职业/教育正常
- [ ] persons 数据与 customers 副本列一致（对账零差异）

---

### CL-09：recruit_candidate_person_sync 触发器退出

**对象**：
- 触发器 `recruit_candidate_person_sync_trigger`（BEFORE INSERT OR UPDATE OF customer_id, person_id ON recruit_candidates）
- 函数 `recruit_candidate_person_sync()`（SECURITY DEFINER）
**所属业务**：招募域。
**设计依据**：[decisions.md](decisions.md) PMC-17 裁决（"recruit 同步触发器按消费者接管证据保留"）；AGENTS.md 规则 9（Legacy 行为优先保留）。

#### 证明（5 条）

| # | 证明项 | 证据 |
| --- | --- | --- |
| 1 | 权威数据已存在 | persons 为权威；recruit_candidates 18/18 行有 person_id（NOT NULL） |
| 2 | 活跃/历史数据已处理 | 触发器在 INSERT 时自动从 customers 数据创建 Person（legacy 行为） |
| 3 | 无未处理依赖 | **不满足**：recruit_candidates/index.js create 传入 customer_id，触发器自动建 Person——legacy 写路径依赖此触发器 |
| 4 | 观察期无合法业务继续依赖 | **不满足**：AGENTS 规则 9 要求保留 legacy 行为；替代路径（PersonService.resolveName + 人工确认）未接入 recruit create |
| 5 | 不影响 pr | 仅 public 对象 |

**结论**：**前置不满足**。须先为 recruit_candidates.create 接入 PersonService 身份解析流程（替代自动建 Person），方可退出触发器。

#### 变更方案（未来执行时）

```sql
-- migration:
DROP TRIGGER IF EXISTS recruit_candidate_person_sync_trigger ON public.recruit_candidates;
DROP FUNCTION IF EXISTS public.recruit_candidate_person_sync();
-- rollback: 从 migration 20260929160746 恢复
```

#### 依赖处理
- **recruit_candidates/index.js create**：须改为先调 PersonService.resolveName（按 customer_id 查已有 Person），返回 person_id；若需新建 Person 走身份命令流程（人工确认）。
- **触发器函数定义**：从 migration `20260929160746_recruit_candidate_person.sql` line 68–117 恢复。

#### 部署顺序
1. 部署 recruit_candidates 函数（create 改走 PersonService）
2. 应用 migration（DROP TRIGGER + DROP FUNCTION）
3. 回归测试

#### 加锁/停机风险
- DROP TRIGGER：极快。
- **无停机**。

#### 备份/回滚/数据恢复
- **备份**：触发器+函数定义完整记录在 migration `20260929160746`。
- **回滚**：从 migration 恢复。
- **数据恢复**：触发器/函数不存数据；回滚恢复触发器即可。**满足 contract E**。

#### 迁移后新增数据处理
- 新增 recruit_candidate 走 PersonService.resolveName + 人工确认 Person。

#### 回归清单
- [ ] 招募创建正常（走 PersonService）
- [ ] 招募列表/详情/评分/推荐正常
- [ ] 回收站正常
- [ ] 独立候选人（无 customer_id）创建正常

---

## 4. 真实冗余与必要历史快照区分

### 真实冗余（前置满足后可清理）

| 项 | 理由 |
| --- | --- |
| CL-05（recruit_candidates.education） | 0 数据、0 消费者、权威在 persons/customers |
| CL-06（recruit_candidates.mbti） | 0 数据、0 消费者、权威在 customers |
| CL-01（D5 约束） | 前置①②③全满足；身份=person_id 非姓名 |

### 有活跃消费者（暂不清理，前置未满足）

| 项 | 活跃消费者 | 前置缺失 |
| --- | --- | --- |
| CL-02（customers 7 副本列） | 11 视图 + customers/index.js + PersonService 投影 | 阶段 3 视图重建未执行 |
| CL-03（legacy_customer_id） | 25 JS 文件 + 复合 FK + 桥触发器 | CL-04 + CL-08 退出 |
| CL-04（复合 FK） | opportunities/recruit_candidates 函数 + 视图 | 读路径迁移 + 对账 N 周 |
| CL-08（桥触发器） | legacy customers.update 绕过路径 | 全量写路径经 PersonService |
| CL-09（recruit 同步触发器） | recruit_candidates.create 自动建 Person | PersonService 接入 recruit create |

### 必要历史快照（不清理）

| 对象 | 理由 |
| --- | --- |
| activity_participants.person_name | D6 确认快照语义，不可变 |
| activity_speakers.name/phone/wechat/organization/position | D6 确认快照语义，不可变 |
| ocr_records.customer_snapshot | OCR 恢复链路依赖 |
| interactions.raw_note | 互动原始记录，不改写 |

---

## 5. 小批次分组

| 批次 | 项 | 风险 | 前置 | 说明 |
| --- | --- | --- | --- | --- |
| **B1** | CL-05, CL-06 | 低 | 无 | 死列清理，0 消费者，可立即执行 |
| **B2** | CL-01 | 低 | B1 无依赖 | D5 约束解除，前置全满足 |
| **B3** | CL-02 | 高 | 阶段 3 视图重建 | customers 7 副本列退出，须先重建 11 视图 |
| **B4** | CL-04 → CL-03 | 高 | CL-04 先行 → CL-03 后跟 | 复合 FK 替换 → legacy_customer_id 列退出 |
| **B5** | CL-08, CL-09 | 中–高 | 全量写路径经 PersonService | 触发器退出，须先确保无绕过路径 |

**批次依赖**：B1 独立 → B2 独立 → B3 独立 → B4 独立 → B5 独立。各批次间无硬依赖，可并行批准，但建议按序执行。

---

## 6. 逐项批准表

> 用户批准本提案 ≠ 批准以下任一项。每项须独立标记批准状态。未标记"已批准"的项默认不执行。

| 编号 | 对象 | 批次 | 风险 | 前置满足 | 批准状态 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| CL-05 | recruit_candidates.education | B1 | 低 | ✅ | **待批准** | 死列，0 数据 0 消费者 |
| CL-06 | recruit_candidates.mbti | B1 | 低 | ✅ | **待批准** | 死列，0 数据 0 消费者 |
| CL-01 | customers UNIQUE(customer_name) | B2 | 低 | ✅ | **待批准** | D5 前置全满足 |
| CL-02 | customers 7 副本列 | B3 | 高 | ❌ | **待批准（前置未满足）** | 须先阶段 3 视图重建 |
| CL-04 | 复合 FK 替换 | B4 | 高 | ❌ | **待批准（前置未满足）** | 须先读路径迁移 + 对账 |
| CL-03 | persons.legacy_customer_id | B4 | 高 | ❌ | **待批准（前置未满足）** | 须 CL-04 + CL-08 先退出 |
| CL-08 | 桥触发器 | B5 | 中 | ❌ | **待批准（前置未满足）** | 须全量写路径经 PersonService |
| CL-09 | recruit 同步触发器 | B5 | 高 | ❌ | **待批准（前置未满足）** | 须 PersonService 接入 recruit create |
| CL-07 | 已删除空洞 | — | — | — | **不清理** | 已删除，仅记录 |

---

## 7. 已排除的登记缺陷（非本提案范围）

| 编号 | 描述 | 状态 | 处理建议 |
| --- | --- | --- | --- |
| G-PMC11-1 | ai_activity analyze top3 缺 ID 白名单 | 登记，未修 | 非"旧冗余字段"类清理；修复属功能修正包 |
| G-PMC17-1 | crm_test_scenario_v1 触发器守卫白名单滞后 | 登记，未修 | 同上；扩充白名单须单独授权 |

---

## 8. 实测证据索引

| 证据 | 来源 | 日期 |
| --- | --- | --- |
| 约束/列/触发器/视图依赖/数据计数 | `tools/pmc-19-catalog.sql` 经 tcb-exec service_role | 2026-10-10 |
| 代码引用 legacy_customer_id（25 文件） | grep cloudfunctions | 2026-10-10 |
| 视图读 customers 副本列（11 视图） | catalog c9 + migration 文件 | 2026-10-10 |
| recruit_candidates 死列（0 非空） | catalog c6 | 2026-10-10 |
| 重复活跃客户名（0 个） | catalog c11 | 2026-10-10 |
| customers person_id（NOT NULL, 783/783） | catalog c2 + c10 | 2026-10-10 |
| 桥触发器定义 | migration `20261004011800` line 701–723 | 2026-10-10 读取 |
| recruit 同步触发器定义 | migration `20260929160746` line 68–117 | 2026-10-10 读取 |
| v_recruit_candidates 视图定义 | migration `20261009091200` line 21–67 | 2026-10-10 读取 |

---

## 9. 验收对照

| 指令条目 | 对应章节 |
| --- | --- |
| 1 每个拟清理对象独立清单 | §2 总表 + §3 逐项 |
| 2 每项 5 条证明 | §3 各项"证明"表 |
| 3 真实冗余与必要历史快照分开 | §4 |
| 4 变更SQL/依赖/部署/加锁/备份/回滚/数据恢复/新增数据/回归 | §3 各项 |
| 5 小批次分组 + 逐项批准表 | §5 + §6 |
| 验收：每项有依据/恢复方案/批准状态；未批准不执行；无暗中清理 | §6 批准表 + 本文件状态声明 |
