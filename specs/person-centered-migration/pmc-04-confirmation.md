# PMC-04：人物身份及数据冲突确认清单（pmc-04-confirmation）

状态：**待用户验收**。本包形成经确认的迁移输入，**不自动合并或批量改写真实人物**。基线：`a2c07f4` / `release-20261008-1830`；实测日期 2026-10-08（工具 `tools/pg-readonly.cjs`，只读查询）。证据索引见 [evidence/PMC-04.md](evidence/PMC-04.md)。

---

## 0. 约束声明

- **不自动合并**：姓名相同、手机号相同、"更新时间较新"都不能单独决定覆盖（execution-contract F）。
- **不让 AI 直接选择 Person**：需要新建或关联 Person 时遵守服务端 `PersonService.resolveName()` 与人工确认（execution-contract G）。
- **不用虚构 Person / 名字后缀 / 任意默认值强行填满关联**。
- **本包默认不执行生产数据修复**；待确认项留待 PMC-06 或届时单独授权。
- **脱敏**：本文档只保存对象 ID、源版本、差异类型、哈希；不输出真实姓名/电话/微信/生日等 PII 值（execution-contract M）。
- **待确认项不计入迁移成功率**。

---

## 1. 工具与基线

| 项 | 值 |
| --- | --- |
| 只读查询工具 | `tools/pg-readonly.cjs`（经 cloudbase-mcp queryPgDatabase，拒绝 DDL/DML/多语句） |
| 冲突检测 SQL | `tools/conflict-check.sql`（第一轮：缺失/一对多/多对一/孤立/软删除/字段冲突/同名不同人） |
| 深查 SQL | `tools/conflict-check-detail.sql`（第二轮：无 legacy 的 Person 角色引用 + 同名组 phone/wechat 哈希比对） |
| 快照位置 | `tests/security/.results/pmc04-conflict-check.json` + `pmc04-conflict-detail.json` |
| 实测时间 | 2026-10-08 11:37–11:39（+08:00） |
| 数据基线 | persons 784（3 软删）/ customers 783（1 软删）/ legacy_matched 779（PMC-03 一致） |

---

## 2. 冲突总览

| 冲突类型 | 数量 | 状态 |
| --- | --- | --- |
| 缺失：customers 无 Person | 3 | 待确认（A1–A3） |
| 缺失：persons 无 legacy_customer_id | 4 | 已分类（A4–A7） |
| 一对多（legacy_customer_id 重复） | 0 | 无冲突 |
| 多对一（多 customers 指向同一 person） | 0 | 无冲突 |
| 软删除不一致 | 0 | 无冲突 |
| 字段冲突（persons vs customers 同名副本） | 1 | 待确认（D1） |
| 同名不同人（name_key 重复组） | 7 组 / 14 人 | 待确认（E1–E7） |
| 孤立引用（speaker/participant/recruit/opp/interaction） | 全 0 | 无冲突 |

**总结**：数据整体干净。阻断项为 0；待确认项集中在"缺失 Person 的 3 个客户"和"7 组同名不同人（基础资料全空，无法自动判断）"。

---

## 3. 分类确认清单

### 3.1 已确认可迁移（无需额外确认）

| 项 | 对象 ID | 证据 | 字段级处理规则 |
| --- | --- | --- | --- |
| M1 | persons ↔ customers 已关联的 779 对（legacy_customer_id 匹配，双方未软删） | conflict-check `field_conflicts.summary.total_compared=779`；name_diff=0（display_name 与 customer_name 一致） | 阶段 2 同步：persons 为权威，customers 副本字段（phone/birthday/gender/occupation/education/wechat）按 persons 值同步；当前 779 对同名副本无双方冲突（name_diff=0） |
| M2 | person 786（无 legacy_customer_id；source=人工新增；role=recruit；recruit_candidates 引用=1） | conflict-detail `no_legacy_persons` person_id=786 | **正常**：纯招募域 Person，无客户角色，不需要 legacy_customer_id；不迁移、不补建关联 |
| M3 | persons 880029290001 / 880029290003（测试数据，已软删） | conflict-detail `no_legacy_persons`；source=[CRM_TEST_ONLY]；softdeleted=true | 保留原值，不迁移（见 3.2） |

### 3.2 保留原值（不迁移、不修改）

| 项 | 对象 ID | 原因 | 备注 |
| --- | --- | --- | --- |
| K1 | person 880029290001（软删，source=[CRM_TEST_ONLY]） | 测试数据已软删；被 activity_participants 引用 1 条（历史参与记录） | 不恢复、不迁移；保留软删状态 |
| K2 | person 880029290003（软删，source=[CRM_TEST_ONLY]） | 测试数据已软删；被 activity_speakers 引用 1 条（历史嘉宾记录） | 不恢复、不迁移；保留软删状态 |

### 3.3 不迁移

| 项 | 对象 ID | 原因 |
| --- | --- | --- |
| N1 | person 880029290001 / 880029290003 | 测试数据已软删，不参与迁移回填 |

### 3.4 待确认（不自动处理，需用户确认或 PMC-06 授权）

#### A. 缺失 Person 的客户（3 个）

| 项 | customer_id | source | 创建时间 | 业务引用 | 候选处理 | 影响 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 786 | 快速记录 | 2026-09-28 | 无（recruit/speaker/opp 全 0） | 建议由用户确认是否需建 Person（经 resolveName+人工确认）；或标记"不迁移"保留原客户记录 | 若建 Person 需补 legacy_customer_id；若不迁移则该 customer 在阶段 2 后仍无 Person |
| A2 | 789 | null | 2026-10-04 | 无 | 同上 | 同上 |
| A3 | 790 | 快速记录 | 2026-10-04 | 无 | 同上 | 同上 |

**根因**：legacy `customers.create` 不建 Person（PMC-01 U1 已补查确认）。这 3 个客户通过"快速记录"或未记录来源创建，未触发 Person 创建。

**建议**：在 PMC-06（或单独授权的实施包）中，由服务端 `PersonService.resolveName()` 对这 3 个 customer 的 customer_name 进行身份解析：
- 若 resolveName 返回唯一匹配的已存在 Person → 人工确认后补 legacy_customer_id
- 若 resolveName 无匹配 → 人工确认后新建 Person 并关联
- 若用户判断该 customer 为测试/无效数据 → 标记不迁移

**不自动处理**：本包不执行任何上述操作。

#### B. person 787（有互动+机会但无客户角色）

| 项 | person_id | source | 创建时间 | 角色引用 | 业务引用 |
| --- | --- | --- | --- | --- | --- |
| A5 | 787 | 人工新增 | 2026-10-06 | 无（has_role=false） | interactions=2, opportunities=1 |

**待确认原因**：该 Person 有 2 条互动和 1 条机会，但没有客户角色（person_roles 无记录）和 legacy_customer_id。可能是通过非客户路径（互动/机会直接创建）创建的 Person。

**建议**：用户核实该 Person 的身份来源：
- 若确认是独立 Person（不关联客户）→ 保留原值，不补建客户关联
- 若发现应关联某客户 → 经 resolveName+人工确认后补 legacy_customer_id

#### C. 字段冲突（1 处）

| 项 | person_id | customer_id | 冲突字段 | 差异类型 | 建议处理 |
| --- | --- | --- | --- | --- | --- |
| D1 | 783 | 788 | occupation | 单边差异：customers.occupation 有值，persons.occupation 为空 | 阶段 2 同步时由用户确认是否将 customers.occupation 值提升为 persons 权威值（persons 当前为空，不存在覆盖冲突） |

**注意**：当前 persons.occupation 为空，customers.occupation 有值。按 data-model.md 规则 persons 是权威——但权威字段为空时，副本有值的情况需要用户确认同步方向。不自动覆盖。

#### D. 同名不同人（7 组 14 人）

| 项 | name_key_hash | person_ids | legacy_customer_ids | 基础资料 | 待确认 |
| --- | --- | --- | --- | --- | --- |
| E1 | 308981699030fb2f3869ebba824e2d5c | [129, 632] | [131, 635] | **全空**（phone/wechat/birthday/gender/occupation/organization/education 均空） | 是否为同名不同人（2 个独立 Person）或误建重复 |
| E2 | 433342dd409c05da0ec40b846aad4c60 | [225, 600] | [228, 598] | 全空 | 同上 |
| E3 | 4abbf1e4f1926daacb6eac57d33b5f1b | [430, 605] | [433, 603] | 全空 | 同上 |
| E4 | 692de2c461298c11ec23b9f03335a5b0 | [239, 240] | [242, 243] | 全空 | 同上 |
| E5 | 908255b51840e4a95eb29c7fb9c98355 | [308, 497] | [311, 500] | 全空 | 同上 |
| E6 | bf24aff0c6bdd0d11ca666aefb6129ed | [36, 37] | [37, 38] | 全空 | 同上 |
| E7 | e9b0626708cde2ab56d45b979e0e0ae9 | [198, 593] | [200, 591] | 全空 | 同上 |

**关键发现**：所有 7 组同名不同人的**全部基础资料字段（phone/wechat/birthday/gender/occupation/organization/education）均为空**（哈希值 `d41d8cd98f00b204e9800998ecf8427e` = md5('')）。

**含义**：
- 无法通过 phone/wechat 判断是否为同一人（merge_candidate_count=0）
- 这 14 个 Person 各自关联了不同的 customer（legacy_customer_id 不同）
- 可能是真正同名同姓的不同人，也可能是误建的重复 Person
- **必须由用户人工确认**——不让 AI 自动选择合并或保留

**建议处理**（在 PMC-06 或单独授权时）：
1. 对每组 2 个 Person，由用户核实其 customer 记录的详细资料（需登录系统或查看受保护位置的真实资料）
2. 若确认为同一人 → 经 resolveName+人工确认后合并（将 2 个 customers 指向同一 Person，或合并为 1 个 Person+1 个 customer 记录）
3. 若确认为不同人 → 保留现状，标注"同名不同人已确认"
4. 若暂时无法判断 → 标注"同名待决"，不阻断迁移但计入待确认项

**阻断后续模块**：E1–E7 **不阻断** customers.person_id 回填（因为各自已有 legacy_customer_id 关联）；但**阻断** D5（customers UNIQUE(customer_name) 退出条件），因为同名不同人未确认前不能解除姓名唯一约束。

### 3.5 存在阻塞

**无阻塞项**。

- 孤立引用全 0：无阻断
- 一对多/多对一全 0：无阻断
- 软删除不一致全 0：无阻断
- 字段冲突仅 1 处（D1，单边差异，非阻断）
- 同名不同人 7 组（E1–E7）：**不阻断** person_id 回填，但**阻断** D5 姓名唯一约束退出

---

## 4. 待确认项的候选、差异、建议及影响汇总

| # | 待确认项 | 候选 | 差异 | 建议 | 影响 / 阻断 |
| --- | --- | --- | --- | --- | --- |
| A1 | customer 786 无 Person | ① 建 Person ② 标记不迁移 | 无业务引用 | resolveName+人工确认 | 不阻断 person_id 回填 |
| A2 | customer 789 无 Person | 同上 | 同上 | 同上 | 同上 |
| A3 | customer 790 无 Person | 同上 | 同上 | 同上 | 同上 |
| A5 | person 787 有互动+机会但无客户角色 | ① 保留独立 Person ② 补客户关联 | interactions=2, opportunities=1 | 用户核实身份来源 | 不阻断 |
| D1 | person 783/customer 788 occupation 单边差异 | ① 同步 customer 值到 person ② 保留原值 | customer 有值, person 为空 | 用户确认同步方向 | 不阻断 |
| E1–E7 | 7 组同名不同人（基础资料全空） | ① 合并 ② 确认不同人 ③ 待决 | 无 phone/wechat 可比对 | 人工核实真实资料 | 阻断 D5 姓名唯一约束退出 |

---

## 5. 版本约束与后续消费

### 5.1 本清单的版本约束

| 项 | 值 |
| --- | --- |
| 基线提交 | `a2c07f4` / `release-20261008-1830` |
| 数据快照 | `tests/security/.results/pmc04-conflict-check.json` + `pmc04-conflict-detail.json` |
| observedAt | 2026-10-08 11:37–11:39（+08:00） |
| 数据规模 | persons 784 / customers 783 / legacy_matched 779 |

**约束**：本清单的"已确认可迁移"项仅在数据快照时间点有效。若后续在 PMC-05/06 执行前有新增/修改 persons 或 customers 数据，需重新执行 conflict-check.sql + conflict-check-detail.sql 刷新清单。

### 5.2 后续模块消费方式

| 后续模块 | 消费本清单的方式 |
| --- | --- |
| PMC-05+（实施包） | 回填 `customers.person_id` 时：M1 的 779 对可直接回填（legacy_customer_id → person_id）；A1–A3 的 3 个 customer 不回填（待确认）；E1–E7 的 14 个 person 各自已有 legacy_customer_id，person_id 回填不冲突 |
| PMC-06（纠错/补建） | A1–A3（建 Person 或标记不迁移）、A5（person 787 身份核实）、D1（occupation 同步）、E1–E7（同名不同人合并/确认）均留待此包 |
| D5 退出条件 | E1–E7 确认完毕前不解除 customers UNIQUE(customer_name) |

### 5.3 待确认项不计入迁移成功率

- 迁移成功率分母 = 已关联 779 对（M1）+ 纯招募 Person（M2）= 780
- 待确认项 A1–A3（3 个 customer）+ A5（1 个 person）+ D1（1 处）+ E1–E7（7 组 14 人）**不计入分子**
- 阻断项 = 0（E1–E7 阻断 D5 退出但不阻断 person_id 回填）

---

## 6. 脱敏与受保护证据

| 项 | 位置 | 用途 |
| --- | --- | --- |
| conflict-check 快照 | `tests/security/.results/pmc04-conflict-check.json` | 脱敏冲突清单（ID + 差异标记 + 哈希，无 PII） |
| conflict-detail 快照 | `tests/security/.results/pmc04-conflict-detail.json` | 脱敏深查（角色引用 + phone/wechat 哈希，无 PII） |
| 真实客户资料 | 不入 Git；需查看时登录生产系统或受保护位置 | 人工确认同名不同人时查看 |
| name_key 哈希 | md5(name_key) | 替代真实姓名，用于组内比对 |

---

## 7. 验收对照

| 验收要求 | 本包达成 |
| --- | --- |
| 找出缺失/一对多/多对一/孤立/软删除/字段冲突 | ✅ 两轮只读查询，7 类全覆盖 |
| 以 ID 和来源证据区分 5 类记录 | ✅ §3.1–3.5 五分类 |
| 待确认项给候选、差异、建议、影响 | ✅ §4 汇总表 |
| 每项记录对象 ID、源版本、目标 Person、字段级处理规则 | ✅ §3 各表 + §5.1 版本约束 |
| 原始客户资料受保护，Git 只保存脱敏索引 | ✅ §6 脱敏声明 |
| 不用虚构 Person / 名字后缀 / 默认值强行填关联 | ✅ 未执行任何写入 |
| 本包不执行生产数据修复 | ✅ 纯只读查询+文档 |
| 待确认项不计入迁移成功率 | ✅ §5.3 |
| 阻断哪些后续模块明确 | ✅ E1–E7 阻断 D5；其余不阻断 |
