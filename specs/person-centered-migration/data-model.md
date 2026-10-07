# PMC-02：目标数据模型与接口契约设计（data-model）

状态：**设计已获用户批准（2026-10-07，D1–D11 全部按建议方案批准）**。本文件只做设计、字段字典与确认清单，**不实施任何迁移**；所有"目标"均为设计意图，实施须在用户对具体实施包下发指令后执行。基线：`86480ab`（标签 `release-20261007-2217`）；实测日期 2026-10-07（工具 `tools/pg-readonly.cjs`，只读查询）。证据索引见 [evidence/PMC-02.md](evidence/PMC-02.md)。

---

## 1. 主实体与 ID 契约

### 1.1 实体与物理表映射（不重命名声明）

| 领域概念 | 物理载体 | 说明 |
| --- | --- | --- |
| **Person（人物主实体）** | `public.persons` | 唯一权威。**"Person" 是领域概念，不重命名物理表**；现有表名/列名保持不变 |
| 客户角色 | `public.customers` | 业务状态 + 客户域字段权威 |
| 招募候选 | `public.recruit_candidates` / `recruit_followups` | 招募域权威 |
| 嘉宾档案/合作 | `public.activity_speakers` | 嘉宾域权威 |
| 活动参与事实 | `public.activity_participants` | 参与记录权威 |
| 人人关系 | `public.relationships` | 关系域权威 |
| 角色登记 | `public.person_roles` | 派生登记表（现状已存在） |
| 业务事实实体 | `opportunities`、`followups`、`products`（保单）、`gifts`、`photos`、`policy_review_reports`、`ocr_records`、`ai_recommendations`、`interactions`、`actions`、`commitments` | 各自保留业务实体，身份字段收敛后仍为独立业务行 |

**ID 语义保持**：客户 ID（`customers."Id"`，int4）、候选人 ID（`recruit_candidates.id`）、嘉宾 ID（`activity_speakers.id`）、参与记录 ID（`activity_participants.id`）、活动 ID、互动 ID、机会 ID——各自语义不变，**不因 Person 中心化改写或混用**。跨域引用一律通过显式外键列（见第 5 节）。

### 1.2 ID 类型实测（2026-10-07，information_schema）

| 表.列 | PG 类型 | JS Number 上限内？ | 现状传输方式（代码实测） |
| --- | --- | --- | --- |
| persons.id | **bigint (int8)** | 不保证（int8 最大 2^63-1 > 2^53-1） | Person 链全用 `String()`（person_360/index.js L247 `personId: String(person.id)`；RDB 过滤参数字符串拼接） |
| customers."Id" | **integer (int4)** | 安全（int4 max 2,147,483,647 < 2^53-1） | legacy `parseInt(event.id, 10)`（customers/index.js L71 等） |
| recruit_candidates.id | **bigint (int8)** | 不保证 | legacy `parseInt(event.id, 10)`（recruit_candidates/index.js L93 等）——**前瞻精度风险模式** |
| opportunities.id / recruit_followups.id / interactions.id / relationships.id / activity_*.id / gifts.Id / products.id / policy_review_reports.id / ocr_records.id / ai_recommendations.id | bigint | 不保证 | 各函数现有解析方式不一（详单见 evidence） |
| followups."Id"、photos.id、customers."Id"、ai_recommendations.customer_id、opportunities.customer_id | integer | 安全 | parseInt 可接受 |
| person_identity_commands.id | uuid | — | 字符串传输 |

**序列余量实测**（pg_sequences）：`persons_id_seq=787`、`recruit_candidates_id_seq=20`、`opportunities_id_seq=11`、`interactions_id_seq=13`——当前值远低于 2^53，**短期无实际风险**；但契约不依赖余量（手工导入/未来迁移可产生大 ID）。

### 1.3 ID 精度契约（强制规则，实施包必须遵守）

- **R-ID1**：int8 ID（persons.id 及一切 bigint ID）在 HTTP/JSON 传输与 JS 内存中一律**字符串**；返回结构中的 ID 字段输出为字符串（新字段命名 `*Id` 时附 `String(id)`）。
- **R-ID2**：禁止对可能为 int8 的 ID 使用 `Number()` / `parseInt()` / 位运算；比较、Map 键、去重一律基于字符串；数值排序下推数据库。
- **R-ID3**：int4 ID（customers."Id"、followups."Id"、photos.id 等）现有 `parseInt` 模式可保留，但新代码统一字符串入参 + 服务端校验 `^\d{1,10}$` 后按 int4 使用。
- **R-ID4**：**禁止混用**：`customer_id` 与 `person_id` 是两个不同命名空间的 ID，任何接口不得接受"一个 ID 字段同时当两种用"；入参名必须显式（`customerId` / `personId`）。
- **R-ID5**：数据库内 int8 不改类型（不改列类型 = 不触发视图/函数重建风险）；精度问题只在 JS 边界解决。
- 实施注记：recruit_candidates 等函数对 **bigint 主键**的 `parseInt` 模式列入对应实施包的"需修改"清单（当前序列值小，非紧急，但改造该函数时必须一并修正）。

---

## 2. 字段归属字典

### 2.0 归属判定原则

| # | 原则 |
| --- | --- |
| A1 | 描述"这个人本身"且跨域复用（姓名、性别、生日、电话、微信、职业、单位、学历）→ **Person** |
| A2 | 描述"作为客户的经营状态"（阶段、优先级、收入分层、经营标签）→ **customers** |
| A3 | 描述"作为候选人的招募过程"（阶段、评分、动机、顾虑、评估标签、附件）→ **招募域** |
| A4 | 描述"作为嘉宾的合作档案"（合作次数、擅长主题、 relationship_stage）→ **嘉宾域** |
| A5 | 描述"在那场活动中的事实"（邀请、出席、席位、当时登记名）→ **参与记录** |
| A6 | 人与人的关系 → **relationships** |
| A7 | 业务事实（保单、机会、任务、互动、跟进、礼品、照片、OCR、检视报告）→ 各自业务表 |
| A8 | **同名不同义不机械合并**：逐项裁决见 2.7；两个域同名字段默认各自保留 |
| A9 | 归属唯一：每个字段有且只有一个权威表；其他出现即为"副本/快照"，标明同步方向（见 2.9） |

### 2.1 persons 字段字典（16 列，实测）

| 列 | 类型 | 含义 | 当前写者 | 当前读者 | 迁移规则 |
| --- | --- | --- | --- | --- | --- |
| id | bigint | Person ID | 序列/触发器/身份命令 | 全部 | 不变；对外字符串化（R-ID1） |
| display_name | text NOT NULL | 展示名 | 身份命令、触发器、Console | 全部 | **权威**；客户域 `customer_name` 为其副本（阶段 2 起同步） |
| name_key | text NOT NULL | 归一化检索键（normalizeWhitespace+toLowerCase，person-service.js L54） | PersonService | resolveName 检索 | **非唯一、非身份主键**；仅检索辅助 |
| phone | text | 电话（单值） | 身份命令、Console | 全部 | 权威；customers.phone 为副本 |
| wechat | text | 微信 | 身份命令、Console | Console/助手 | 权威；customers.wx_account 为其异名列副本（映射 wx_account→wechat） |
| gender / birthday / occupation / organization / education | text/date | 通用基础资料 | 同上 | 全部 | 权威；customers 同名列（education/occupation/birthday/gender）为副本 |
| source | text | **建档来源**（该 Person 因何建立） | 身份命令、触发器 | Console | 权威；**与 customers.source（获客渠道）不同义，不互相映射** |
| notes | text | 人物备注 | Console 人工 | Console | 权威；**初始为空，不自动回填** customers.additional_info（见 2.7-备注） |
| legacy_customer_id | int4 | 过渡锚点（UNIQUE） | 回填脚本 | 桥接查询 | 过渡保留；退出条件见 5.4 |
| created_at / updated_at | timestamptz NOT NULL | 时间戳 | 触发器/代码 | 并发检查 | 不变；updated_at 兼作乐观锁读取值 |
| deleted_at | timestamp（无时区） | 软删除 | 删除流程 | 过滤条件 | 不变；类型差异（无时区）本轮不改 |

### 2.2 customers 字段字典（29 列，实测）

| 列 | 类型 | 含义 | 归属裁决 | 迁移规则 |
| --- | --- | --- | --- | --- |
| "Id" | int4 PK+UNIQUE | 客户记录 ID | customers | 不变（语义=客户角色记录，非 Person） |
| customer_name | text NOT NULL，**UNIQUE（客户列表_姓名_key）** | 客户姓名 | **副本**（权威=persons.display_name） | 阶段 2 起双向同步；**UNIQUE 约束是"姓名作身份主键"的遗留，退出方案见 5.3/D5** |
| phone / birthday / gender / occupation / education | — | 基础资料 | **副本**（权威=persons 同名列） | 阶段 2 起同步；阶段 3 视图改读 persons；列保留至阶段 4 单独批准退出 |
| wx_account | text | 微信 | **副本**（权威=persons.wechat，异名映射） | 同上 |
| customer_stage | enum | 营销销售阶段 | **customers（权威）** | 不迁 |
| sales_priority / recruitment_priority / referral_priority | enum | 经营分层优先级 | customers（权威） | 不迁 |
| annual_income | integer | 个人年收入（经营资料） | customers（权威） | 不迁（见 2.7-收入） |
| household_income | text | 家庭年收入（自由文本） | customers（权威） | 不迁 |
| marital_status | text | 婚姻状况 | customers（权威） | **裁决：客户经营画像字段**；是否属"通用基础资料"待 D3 一并确认（建议保留 customers，理由：由客户建档流程维护，Person 域无此列） |
| mbti | text | 性格测评（客户画像） | customers（权威） | 见 2.7-性格 / D3 |
| tags | text | 经营标签 | customers（权威） | 见 2.7-标签 |
| hobbies / properties_info / additional_info / profile(jsonb) | text/jsonb | 经营画像自由字段 | customers（权威） | 不迁；additional_info 与 persons.notes 不合并（D4） |
| source | text | **获客渠道**（客户来源） | customers（权威） | 与 persons.source 不同义，不映射 |
| next_action / next_action_date | text/date | 客户下一步动作 | customers（权威） | 不迁 |
| first_contact_date | date | 首次接触 | customers（权威） | 不迁 |
| created_at / updated_at / deleted_at / delete_batch_id | — | 时间戳/软删/批次 | customers | 不变（级联语义见 4.3） |
| **person_id（新增，设计）** | bigint | → persons.id | customers | 见第 5 节设计 |

### 2.3 招募域字段（recruit_candidates 38 列节选身份相关；业务列不动）

| 列 | 归属裁决 | 迁移规则 |
| --- | --- | --- |
| id（bigint） | recruit_candidates | 不变；R-ID1/2（现状 parseInt 待改） |
| customer_id（bigint，可空，FK） | 过渡关联 | 保留至 U6/D8 批准收敛 |
| **person_id（bigint NOT NULL，FK）** | recruit_candidates | **已存在**（复合 FK 一半）；不变 |
| education / mbti | **招募域（评估快照语义）** | **不回写 persons**：招募评估时填写的教育/MBTI 是评估时点记录（D3/D6 确认）；persons.education 权威不受其覆盖 |
| motivation / concerns / work_experience / family_situation / personality_tags / career_plan | 招募域评估资料 | 不迁；personality_tags 与 customers.tags 不同义 |
| stage / stage_changed_at / potential_score / potential_reason / next_action / next_action_date / operator | 招募过程状态 | 不迁 |
| activity_history(jsonb) / radar_image_* / winner_report_* / profile(jsonb) | 招募附件/画像 | 不迁 |
| recommender_id（bigint） | 招募域（推荐人，语义=Person ID，待实施包核实指向） | 保持；实现包须核实其引用目标并按 R-ID1 字符串化 |

### 2.4 嘉宾域字段（activity_speakers 23 列）

| 列 | 归属裁决 | 迁移规则 |
| --- | --- | --- |
| id（bigint） | activity_speakers | 不变 |
| person_id（bigint 可空，FK→persons） | 嘉宾域关联 | 已存在；不变（补齐率与回填属嘉宾域实施包） |
| customer_id（bigint 可空，**无 FK**）/ recruit_candidate_id | 过渡关联 | 保留；U3（无 FK 原因）另行补查 |
| **name / phone / wechat / organization / position** | **当时登记快照**（嘉宾域） | **不迁、不回写**：嘉宾建档时登记的姓名/职务是"当时快照"；Person 后续更新不覆盖（D6）。实施包可为已确认 Person 的嘉宾行提供"刷新为当前基础资料"的显式人工操作，但不自动 |
| relationship_stage / cooperation_count / expertise / topic_summary / source / last_contact_* / preferred_format / status / notes | 嘉宾合作档案 | 嘉宾域权威，不迁（source=嘉宾信息来源，第三种"来源"语义） |

### 2.5 参与记录字段（activity_participants 14 列）

| 列 | 归属裁决 | 迁移规则 |
| --- | --- | --- |
| person_name | **当时登记快照** | 不迁不回写（与 D6 同规则） |
| person_id（bigint 可空，**无 FK**） | 参与记录关联 | 保留；U2（无 FK 原因）另行补查 |
| canonical_person_id（bigint，FK→persons） | 参与记录的"确认身份" | 已存在；不变 |
| participant_role / status / followup_status / relationship_note / ai_followup_suggestion | 活动参与事实 | 不迁 |

### 2.6 关系域与互动（relationships 14 列 / interactions 13 列）

- relationships：from/to/introduced_by_person_id（三个 bigint FK）+ relationship_type/stage/strength/trust_level/trend/context(jsonb) —— 全部关系域权威，不迁。
- interactions：person_id NOT NULL（bigint）+ interaction_type/at/channel/summary/raw_note/source_type/source_id/importance —— **互动事实实体**，不迁；summary/raw_note 为互动内容，不是"人物备注"。

### 2.7 争议字段逐项澄清（同名不机械合并）

| 概念 | 现状列 | 裁决 | 理由与规则 |
| --- | --- | --- | --- |
| **收入** | customers.annual_income（integer）、household_income（text） | **customers 权威，不迁 Person** | 收入是客户经营/销售分层资料，非身份资料；两列类型不一（数字/文本）也不具备合并条件 |
| **需求** | 无独立"需求"列；散见于 opportunities.opportunity_type、followups.next_followup_goal、context_items（结构化事实）、customers.next_action | **保持现有承载**，不新建"person.需求" | "需求"是过程性/事实性信息，各有业务实体；PMC 不为其建新模型 |
| **性格** | customers.mbti、recruit_candidates.mbti、recruit_candidates.personality_tags | **按域各自保留**（D3 确认） | 客户 MBTI=客户画像；候选人 MBTI/性格标签=招募评估快照；同名不同义不合并；不迁 persons |
| **标签** | customers.tags（经营标签）、recruit_candidates.personality_tags（评估标签） | 各自保留 | 语义不同；不合并 |
| **来源** | persons.source（建档来源）、customers.source（获客渠道）、activity_speakers.source（嘉宾信息来源） | **三种语义，互不映射** | 典型同名不同义；任何"迁移"不得互相覆盖 |
| **备注** | persons.notes、customers.additional_info、activity_speakers.notes、gifts.notes、photos.photo_notes、activity_participants.relationship_note、followups.followup_notes | **全部保留原表**；persons.notes 初始为空，仅人工维护"关于这个人本身"的长期备注 | 混合备注（既有身份又有业务）**不得经 AI 拆分后直接覆盖原文**；AI 拆分只允许产出"建议 + 预览 + 人工确认后追加结构化记录（如 context_items/notes 追加）"，原文永不改写（对齐 execution-contract F/G、AGENTS 规则 7/14） |

### 2.8 业务实体保留声明

保单（products）、机会（opportunities）、任务（actions/commitments/activity_tasks）、互动（interactions）、跟进（followups/recruit_followups）、礼品、照片、OCR、检视报告、AI 推荐各自保留业务实体与业务外键；本轮只在**身份关联**上收敛（customer_id/person_id 显式化），不做业务实体合并。

### 2.9 副本与同步方向总表（阶段 2 生效，D9 确认）

| 权威字段（persons） | 副本列 | 同步方向 | 冲突裁决 |
| --- | --- | --- | --- |
| display_name | customers.customer_name | persons→customers（写路径经服务端映射） | persons 赢 |
| phone / birthday / gender / occupation / education | customers 同名列 | persons→customers | persons 赢 |
| wechat | customers.wx_account | persons→customers | persons 赢 |
| customers.customer_stage / priorities / income / tags / mbti / marital_status / hobbies / additional_info / profile / source / next_action* / first_contact_date | —（无副本） | customers 自治 | customers 赢 |

反向（Console 编辑 Person 基础资料）同样经服务端把 persons 变更同步到 customers 副本列，保证 legacy 读数一致；对账 SQL 见 6.4。

---

## 3. 资料层级：一般资料 / 领域资料 / 历史快照

| 层级 | 定义 | 典型字段 | 更新规则 |
| --- | --- | --- | --- |
| **一般资料** | 描述人本身的当前事实 | persons 的 name/phone/birthday/gender/occupation/organization/education/wechat | 随人工编辑更新；有唯一权威 |
| **领域资料** | 描述某角色/业务过程的状态 | customer_stage、recruit stage、嘉宾合作档案、优先级、收入 | 各域权威自治；不因 Person 编辑而变 |
| **历史快照** | 某时点登记的事实，用于审计/回溯 | activity_participants.person_name、activity_speakers.name/organization/position/phone/wechat、ocr_records.customer_snapshot、ai_* 快照、interactions.raw_note | **不可变**：Person 当前值更新**永不回写覆盖**快照（如 Person 的当前职业不覆盖历史活动中的当时职务）；快照与当前基础信息分开读取 |

补充规则：

- **混合备注**：AI 辅助拆分备注仅允许"建议→预览→人工确认→追加结构化记录"路径，禁止直接改写原文（2.7-备注）。
- **多电话 / 多地址**：现状全部为单值字段（persons.phone 等）。**本轮不设计 person_phones / person_addresses 从属表**；仅当出现真实业务需求（如确需记录多个可拨号码并区分用途）时另立工作包设计（D7）。临时做法：文本字段内人工备注，不做结构化。

---

## 4. 角色基数、业务唯一性与软删除

### 4.1 角色模型（person_roles 实测：UNIQUE(person_id, role)，无 deleted_at）

实测分布（2026-10-07）：customer 779（legacy_backfill 776 + manual 3）、recruit 14（12+2）、speaker 4（3+1）、participant 2（1+1）；origin ∈ {legacy_backfill, manual}。

| 角色 | 一人允许角色登记 | 业务记录基数 | 说明 |
| --- | --- | --- | --- |
| customer | 0..1（UNIQUE 兜底） | customers 行：目标 **0..1**（person_id UNIQUE，D1） | 一人多条客户记录不在目标模型内；如出现按 resolveName 流程并档（人工） |
| recruit | 0..1 | recruit_candidates 行：**0..1**（现状 person_id NOT NULL 且业务上一人一候选；实施包加 UNIQUE 校验候选，D 清单） | 触发器 `recruit_candidate_person_sync` 现状自动建 Person（legacy 行为保留，规则 9） |
| speaker | 0..1 角色标记 | activity_speakers 行：**0..n**（同一人可多场活动多条合作记录；现状一人多行即多档案，收敛为"档案 1 + 合作记录 n"是嘉宾域实施包目标，本轮只声明方向） | |
| participant | 0..1 角色标记 | activity_participants 行：0..n（每场活动一条） | 参与事实天然多条 |
| 其他（household 等） | 不在本轮范围 | — | |

- **角色登记为派生数据**：person_roles 无 deleted_at，其存续跟随业务记录（customers/recruit_candidates/activity_speakers/activity_participants）的有效状态派生维护；不单独软删角色行。实施包以"重算"而非"逐行增删"实现，避免漂移。

### 4.2 软删除语义现状（实测）

| 域 | 软删列 | 级联机制 |
| --- | --- | --- |
| 客户域 | customers.deleted_at（timestamp 无时区）+ delete_batch_id(uuid) | **同一 deleted_at 时间戳级联**子表（followups/gifts/photos/products/policy_review_reports/ocr_records，均含 delete_batch_id）；回收站按批次恢复 |
| persons | deleted_at（timestamp 无时区） | 无级联（Person 删除不级联业务表） |
| 招募/嘉宾/参与/关系/机会 | 各自 deleted_at | 各自独立；活动域参与记录经 `crm_delete_batch` RPC |

### 4.3 删除/恢复兼容方案（目标语义，D10 确认）

- **删除客户角色**：软删 customers 行 + 现有时间戳级联子表 + person_roles 的 customer 角色派生失效。**不动 persons 行**——即使该 Person 无任何其他有效角色（保留 Person 以保历史互动/参与/关系完整）。
- **恢复**：按 delete_batch_id 批次恢复（现状语义）；恢复客户角色后 person_roles 派生重建。
- **删除 Person（Console 既有能力）**：软删 persons 行；业务表（interactions/participants/relationships/机会等）**不级联**；resolveName 检索排除软删（person-service 已 `deleted_at: 'is.null'`）；已删 Person 经回收站流程恢复。删除 Person 前置校验"存在有效客户/招募角色时须先删除角色或显式确认"由实施包提供。
- **已删除人物出现在旧接口**：customers.list 等返回的副本字段（customer_name 等）在阶段 3 前仍来自 customers，不受 persons 软删影响；阶段 3 视图改读 persons 时，**读路径必须以角色表有效状态为主、persons 基础字段 LEFT JOIN**（persons 软删不隐藏客户记录，仅基础字段取自软删行——保证回收站可见性，兼容方案随视图重建包细化并回归）。

---

## 5. customers.person_id 关联设计与 legacy_customer_id 退出

### 5.1 目标关联（新增列，migration+rollback 由实施包提供）

- `customers` 新增 `person_id bigint`，**UNIQUE**（一人一条客户记录，D1），回填完成后置 `NOT NULL` 并加 FK `REFERENCES persons(id)`。
- 分步：①加可空列（不锁视图）→ ②回填 → ③校验一对一 → ④加 UNIQUE + FK + NOT NULL（此步涉及约束变更，实施包单独确认）；每步核对依赖视图（`pg-view-rebuild-check`）。

### 5.2 回填规则

1. `customers` ⋈ `persons.legacy_customer_id` 精确匹配 → 直接回填（预期 780 对；实测基线 2026-10-07）。
2. **3 个无 Person 客户（U1 已补查）**：Id 786（2026-09-28 建，1 条跟进，姓名 6 字符）、789/790（2026-10-04 建，其一 1 条跟进，姓名 3 字符），均未删除、无嘉宾/机会/招募关联。**根因**：legacy `customers.create` 不创建 Person。处置选项 → **D2**（推荐 A：走既有身份命令流程补建 Person，人工确认后回填）。
3. 回填校验 SQL：一一映射、无重复、无遗漏，结果入证据。

### 5.3 同名不同人 / 一人多角色 / 已删除人物 / 姓名唯一约束

- **不再以姓名作为身份主键**：身份=person_id；姓名仅展示与检索（name_key 辅助）。
- **`customers.UNIQUE(customer_name)`（客户列表_姓名_key）是唯一以姓名为身份的现存约束**——解除它才允许同名不同人入客户域。**退出条件（D5，单独批准）**：①customers.create/update 已走服务端 resolveName 并返回"同名候选"错误/提示 ②person_id 回填完成且 NOT NULL ③重复名存量客户（若存在）已人工并档或标注。在此之前该约束保留（它同时挡住重复建档）。
- **同名不同人**：经 `PersonService.resolveName()` 服务端解析 → 返回候选 → **人工确认**；不自动合并/自动选定（AGENTS 规则 14、contract F/G）。
- **同一人多角色**：目标模型原生支持（一人 0..1 客户 + 0..1 候选 + 0..n 嘉宾/参与记录；person_roles UNIQUE(person_id,role) 兜底）。
- **已删除人物**：见 4.3；不新建关联到软删 Person（resolveName 已排除）。

### 5.4 legacy_customer_id 生命周期

| 阶段 | 用途 |
| --- | --- |
| 现状 | 唯一桥：persons→customers 关联 + 复合 FK `(legacy_customer_id,id)` 被 opportunities/recruit_candidates 引用 |
| 阶段 2（双写） | 保留作为回滚锚点与对账键；新读路径逐步改用 customers.person_id |
| 阶段 3（读切换） | 复合 FK 的替代（直接 FK→customers.person_id 或 FK→persons.id）由实施包设计；legacy_customer_id 降级为历史审计列 |
| **退出条件（全部满足才申请批准删除列/约束，D8）** | ①全量读路径（含 12 视图）改走 person_id 且回归通过 ②双写对账连续 N 周（建议 4）零差异 ③无代码引用（grep + 函数扫描证据）④用户单独批准删除 |

### 5.5 opportunities / recruit_candidates 双 FK（U5/U6）

现状复合 FK `(customer_id, person_id) REFERENCES persons(legacy_customer_id, id)` 使两表同时绑 customers 与 persons。目标：机会/招募域最终仅保留 person_id FK；customer_id 列与复合 FK 退出**列为收尾阶段单独批准项**（D8），期间保持双轨不动。

---

## 6. 接口契约（受影响 action）

### 6.0 通用契约规则（适用于下述全部 action）

| # | 规则 |
| --- | --- |
| C1 | **旧入参全兼容**：所有现有入参继续接受、语义不变；新增入参一律可选（如 `personId`）。旧前端（admin.html 缓存版本）不升级可继续使用 |
| C2 | **返回叠加不破坏**：现有返回字段全部保留；新增字段只增不改（如 `personId: "784"` 字符串）。前端旧逻辑不受影响 |
| C3 | **字段清空规则**：服务端**禁止静默清空**——仅当请求显式传 `null` 且该字段在可清空白名单内才置空；阶段 2 起，请求中包含基础字段（name/phone/birthday/gender/occupation/education/wx_account）时服务端映射写 persons（权威）并回写副本列；未传字段不做 patch 之外的处理 |
| C4 | **并发版本检查**：现状为 last-write-wins（updated_at 仅展示）。兼容增强：所有 update 类 action 接受可选 `expectedUpdatedAt`；提供且与库内 updated_at 不符 → 返回 `409 CONFLICT_VERSION`（附当前值），不覆盖。不传则维持现状行为（旧前端无感） |
| C5 | **错误码统一**：`PERSON_NOT_FOUND`（personId 无效/已删）、`PERSON_AMBIGUOUS`（同名多候选，附候选列表）、`CONFLICT_VERSION`、`CUSTOMER_UNLINKED`（客户无 person_id 且操作要求关联）、`NOT_PERMITTED`。HTTP 语义沿用现有 callFn 错误通道 |
| C6 | **幂等**：读/删/恢复按现状天然幂等；create 类以"姓名唯一约束/唯一索引"兜底至 D5 解除，解除后 create 必须带客户端生成 `clientRequestId`（uuid）做服务端去重；Person 命令类沿用既有 `actor_uid + idempotency_key` 模式 |
| C7 | **权限不变**：RLS、函数权限上下文（authenticated / service_role / RPC）维持现状；新列不新授权（视图沿用 security_invoker） |
| C8 | **适配类型**：T1=读时 join 透传（前端无感）；T2=服务端映射双写（写 customers 时同步 persons）；T3=命令化流程（preview→人工确认→execute，仅身份/危险操作） |
| C9 | **同步失败处理**：双写失败时主事务回滚（同库事务内）；跨库/异步场景记录 `sync_error` 并入对账清单（6.4），不阻塞主操作返回 |

### 6.1 客户域（customers ×7 + 客户子表 7 函数）

**customers 函数逐 action 契约**：

| action | 旧入参 | 旧返回 | 阶段 2+ 行为（新增部分） | 适配 |
| --- | --- | --- | --- | --- |
| list | page/pageSize/keyword | customers_view 行（含 customer_name 等） | 每行新增 `personId`（可空字符串）；视图后续由实施包重建（person 基础字段权威化，列名不变） | T1 |
| get | id | customers + 7 子表 | 同上 + `personId` | T1 |
| create | customer_name/phone/... 全套 | 新建客户行 | **不自动创建/关联 Person**（人工确认红线）；若命中唯一高置信既有 Person 亦仅返回 `identitySuggestion` 提示，不写关联；`personId` 落入待确认清单由身份命令流程处理（根因修复 U1 增量） | T2'（不写 Person） |
| update | id + data | 更新后行 | data 含基础字段 → 服务端映射写 persons + 回写副本列（C3）；含 `personId` 且当前为空 → 仅登记关联建议，**不直接写关联** | T2 |
| remove | id/ids | 删除结果 | 现状级联不动；person_roles 派生重算；**不删 persons**（D10） | T2 |
| trashList / restore | ids | 行 | restore 后 person_roles 派生重算；persons 不动 | T2 |

**子表 7 函数（followups / gifts / photos / products / policy_review_reports / ocr_records / ai_recommendations）**：同构模板——

| action 组 | 契约 |
| --- | --- |
| list/get（JOIN customers） | 返回新增 `personId`；`customer_name` 等冗余列保留原值（T1；视图/查询由实施包改造） |
| create/update | 入参不变（仍传 customerId）；服务端写入本表 + 校验 customer 有效；**不做** Person 直写（customer_id 足以间接关联） |
| remove / restore | 现状软删/批次恢复不变 |
| **ocr_records.remove 特例** | 保留返回 `customer_snapshot`；前端据此调 `customers.update` 恢复的既有链路**原样兼容**（customers.update 已按 T2 映射 persons，无需前端改动；该链路的目标形态"恢复 Person 字段"由服务端映射天然达成） |

### 6.2 招募域

| action | 契约要点 | 适配 |
| --- | --- | --- |
| recruit_candidates list/get/trashList（走 v_recruit_candidates 视图） | 视图重建：身份字段改 JOIN persons（经 person_id），**列名与类型对外不变**（customer_name 等列保留输出）；新增 personId | T1 |
| create | 现状触发器自动建 Person（legacy 行为保留，规则 9）；返回新增 personId（字符串）；`parseInt` 精度模式一并修正（R-ID2） | T2 |
| update / remove / restore / rcMap / funnel | remove/restore 走 crm_delete_batch 现状不动；rcMap 返回新增 personId | T2/T1 |
| recruit_followups ×4 | 经 candidate_id 间接关联，无直接身份写；list 返回可加 personId | T1 |
| recruit_score / recruit_recommend（读视图） | 视图重建后自动获益；无接口签名变化 | T1 |
| recruit_goals ×5 | 无身份字段——**仅回归**，无契约变化 | — |

### 6.3 活动域

| action | 契约要点 | 适配 |
| --- | --- | --- |
| activities addParticipant / updateParticipant / removeParticipant / linkParticipant / listByPerson / getActivityData | person_id 参与关联现状保留（U2 补查后决定是否补 FK，属实施包）；返回 ID 一律字符串化（bigint）；linkParticipant 语义=人工确认 canonical 身份，保持 | T2 |
| **activity_speakers create（专项 7.1 根因）** | **移除"按姓名自动查/建 customers"**：未传关联时仅按姓名返回 `identitySuggestion` 候选（服务端 resolveName），**不自动建档**；人工经身份命令确认后写 person_id。旧前端传 customer_id 的调用继续接受（读时 join 呈现） | T3 |
| activity_speakers list/get/update/remove/search | 返回新增 personId；快照字段只读（D6） | T1 |
| activity_tasks（related_type=customer 时） | related_id 语义保持 customerId；展示层经 join 取 personId；不改入参 | T1 |
| activity_reports customer/recruit | 报告读取链路改经 person 权威视图取基础字段；输出结构不变 | T1 |

### 6.4 AI 域与其余

| 函数.action | 契约要点 | 适配 |
| --- | --- | --- |
| ai_followup analyze_profile / ai_recommend / ai_referral / today_coach ×4 / funnel_insight ×2 | 全部为读：数据源改经 person 权威（视图/查询重建），入参出参不变；funnel_insight 依赖 v_funnel_stats 重建 | T1 |
| ai_activity activity_review / recruit_coach | 读招募/参与者身份：ID 字符串化；输出结构不变 | T1 |
| person_360 getCustomerProfile / lookupCustomer | **过渡桥保留**至客户域切换完成（阶段 3 后返回结构改以 persons 为主，customers 域字段并入子对象；字段名不变）；完成后标记 deprecated（不删除） | T1 |
| opportunities ×5（admin.html 双轨） | 保持双轨入参（customerId 或 personId 二选一，显式字段名 R-ID4）；服务端校验一致性与 CONFLICT_VERSION | T2 |

### 6.5 阶段权威来源与同步方向（D9 确认）

| 阶段 | 基础身份字段权威 | 客户域字段权威 | 写路径 | 读路径 |
| --- | --- | --- | --- | --- |
| 0 现状 | 两处并存（漂移风险） | customers | 各写各 | 各读各 |
| 1 加列+回填 | customers（暂） | customers | 不变 | 不变 |
| 2 双写 | **persons**（写入经服务端映射） | customers | customers.* action / Console 两个入口，服务端同步 | 不变（视图未动） |
| 3 读切换 | persons | customers | 同上 | 视图/查询改读 persons（列名不变）；customers 副本列停止读取 |
| 4 收敛 | persons | customers | persons 主导 | 副本列/legacy_customer_id 退出（单独批准） |

**失败处理**：同步在数据库事务内（同库）→ 失败整体回滚；对账 SQL（每阶段发布物附）逐日核对 persons↔customers 副本列差异并输出清单；差异仅人工处置，禁止自动覆盖。

---

## 7. 切换与部署次序

### 7.1 模块切换顺序（每阶段内）

| 序 | 模块 | 内容 | 关键回归 |
| --- | --- | --- | --- |
| A | 客户域 | customers.person_id 加列/回填/约束；customers+7 子表函数 T2/T1 改造；5 视图重建（customers_view、followups_view、gifts_view、photos_view、products_view、ai_recommendations_view、v_action_center 涉 customers 部分） | 登录、客户列表/详情、跟进、礼品/照片/保单、OCR 恢复链、回收站 |
| B | 招募域 | recruit 视图 4 张重建（v_recruit_candidates×2、person_only×2 不动）、recruit_candidates 等函数精度修正 | 增员列表/详情/评分/推荐/漏斗、回收站 |
| C | 活动域 | activity_speakers 建档红线改造、activities 参与者 action 字符串化、activity_reports 读路径 | 活动列表/详情、嘉宾管理、复盘、互动/名单/机会候选页签 |
| D | AI 域 | ai_followup/ai_recommend/ai_referral/ai_activity/today_coach/funnel_insight 读路径 | Dashboard/今日教练/漏斗/AI 推荐 |

### 7.2 数据库/函数/前端部署次序与旧客户端缓存兼容

1. **先库**：migration（可空列先行，不破坏视图）+ rollback 就绪；核对依赖视图清单（12 视图基线）。
2. **再函数**：共享模块副本按 `npm run build:shared` 同步 → 逐函数部署（仅受影响函数）；**新函数代码必须兼容旧前端入参/返回（C1/C2）**——这是缓存兼容的核心：旧 admin.html（用户浏览器缓存）继续发旧请求，服务端已按新契约兼容。
3. **后前端**：前端仅在需要展示新字段（personId 等）时升级；静态资源沿用 `?v=` cache-buster；发布以 git 提交清单为准。
4. **每步观察期**：读切换（阶段 3）与约束收紧（NOT NULL/UNIQUE/FK）各自独立成包，前一步回归通过才进入。

### 7.3 回滚与增量数据保存

- 每个 migration 附 rollback；**rollback 不删除已回填数据**（仅摘除约束/降级读路径），保证可重进。
- 双写期回滚=函数回滚（旧代码只写单表，数据不损）；对账 SQL 修复漂移。
- 阶段 3 回滚=视图回退脚本（视图重建包提供原定义备份）。
- 增量数据（切换期间新写入）天然落库，无导出/导入；对账清单覆盖增量。
- 回滚触发条件：回归失败、对账差异超阈值（实施包定，建议 >0 即人工介入）、性能劣化。

---

## 8. 需用户决策清单（已批准；2026-10-07 用户"全部按建议 A 批准"）

> D5、D8 的建议本身是"条件满足后单独批准"，用户一并批准的是该建议路径（约束现状维持、退出须届时单独批准），不构成对删除动作本身的提前授权。

| # | 事项 | 选项 | 建议 | 状态 |
| --- | --- | --- | --- | --- |
| D1 | customers.person_id 基数 | A. UNIQUE 一人一条客户记录；B. 允许一人多条 | A | **已批准 A（2026-10-07）** |
| D2 | U1 三个无 Person 客户（786/789/790）处置 | A. 走身份命令流程补建 Person（人工确认）后回填；B. 仅标记隔离不建 | A | **已批准 A（2026-10-07）** |
| D3 | 性格/婚姻归属 | A. mbti/性格标签/婚姻状况保留各自域不迁；B. 收敛入 Person | A | **已批准 A（2026-10-07）** |
| D4 | 混合备注/标签 | A. 全部保留原表，persons.notes 仅人工维护，AI 拆分只建议不改原文；B. 其他 | A | **已批准 A（2026-10-07）** |
| D5 | customers UNIQUE(customer_name) 约束退出 | 按 5.3 条件在独立包中单独批准 | 维持至条件满足 | **已批准该路径（2026-10-07）：现状维持；解除动作须在独立包单独批准，不提前授权** |
| D6 | 嘉宾/参与记录字段=当时快照（不回写） | A. 确认快照语义；B. 需要回写机制 | A | **已批准 A（2026-10-07）** |
| D7 | 多电话/多地址从属表 | A. 本轮不建；B. 现在就设计 | A | **已批准 A（2026-10-07）** |
| D8 | 双 FK（opportunities/recruit_candidates）customer_id 退出时机 | 收尾阶段单独批准 | 列入收尾 | **已批准该路径（2026-10-07）：双轨维持；退出动作列入收尾阶段单独批准** |
| D9 | 阶段权威来源表（6.5）与基础字段双向同步方案 | A. 按本文件；B. 调整 | A | **已批准 A（2026-10-07）** |
| D10 | 删除客户角色时无其他角色的 Person | A. 保留 Person；B. 一并软删 | A | **已批准 A（2026-10-07）** |
| D11 | customers.create 不自动建 Person（保留人工确认红线，增量走待确认清单） | A. 确认红线；B. 允许自动建（违反规则 14，不建议） | A | **已批准 A（2026-10-07）** |

---

## 9. 指令验收对照

| 指令条目 | 对应章节 |
| --- | --- |
| 1 主实体/ID/精度 | §1 |
| 2 字段归属字典 | §2 |
| 3 三层资料/快照/备注/多值 | §3、§2.7 |
| 4 角色基数/唯一性/软删除兼容 | §4 |
| 5 person_id 关联/legacy 退出/同名/已删 | §5 |
| 6 接口契约/权威来源/同步/失败 | §6 |
| 7 切换次序/缓存/回滚 | §7 |
| 决策集中列明 | §8（登记 decisions.md） |
